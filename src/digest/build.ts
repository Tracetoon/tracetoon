/**
 * The trace digest: a compact, redacted JSON summary of how the PR was made, sized
 * to fit an LLM's context. The host agent writes the PR description from this.
 */
import { traceLabel } from '../integrations/registry.ts';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  attribute,
  evidenceLine,
  isGeneratedPath,
  prLineIndex,
  repoRel,
  type SessionMatch,
} from '../correlate/correlate.ts';
import type { PrTruth } from '../git/pr.ts';
import { ORPHAN_COMMAND, type TraceRecord, type Usage } from '../trace/types.ts';
import { clip, makeScrubber, type Scrubber } from './sanitize.ts';
import { TOOL_VERSION } from '../version.ts';
import { detectInterop, type Interop } from '../git/interop.ts';
import {
  ghTargetsRepo,
  openSegments,
  repoNames,
  shellSegments,
  splitCommands,
} from '../util/shell.ts';
import { cloudNote, cloudSessions } from './cloud.ts';
import { provablyInRepo, runsInRepo } from '../trace/pathMatch.ts';

export interface DigestSession {
  ref: string;
  agent: string;
  title?: string;
  models: string[];
  span: { start?: string; end?: string };
  usage: Usage | null;
  sessionCostUsd?: number;
  score: number;
  band: 'included' | 'ambiguous';
  reasons: string[];
  /**
   * What the user typed. `id` (S1, S2…) lets text cite it. `ledToEdits`: led to
   * edits that survive in the PR. `pushback`: typed while rejecting the agent's
   * action, so it steers or corrects what the agent was doing.
   */
  prompts: {
    id?: string;
    t?: string;
    text: string;
    ledToEdits: boolean;
    pushback?: boolean;
  }[];
  /**
   * Every prompt the user typed in the whole session log Tracetoon read
   * (kept or not): how many, and when the first was typed. A kept prompt is
   * "the first request of the session" only when it is that first one.
   */
  userPrompts?: { count: number; firstT?: string };
  /** Tasks the agent handed to its own subagents. */
  delegations: { t?: string; text: string }[];
  /** Short SHAs of PR commits made during this session. */
  commitsMade: string[];
  /** `approved: false` means sent back; that alone doesn't mean its design was rejected. */
  plans: { id?: string; t?: string; approved?: boolean; excerpt: string }[];
  /** Documents the agent kept for the session (Antigravity task, plan, walkthrough). */
  artifacts: { name: string; summary?: string; excerpt: string }[];
  /**
   * Questions the user answered. `questions` (when the log has them) keeps the
   * options and the exact answer. An option that wasn't picked is only that:
   * not picked. `ownWords`: the user answered in their own words.
   */
  decisions: {
    id?: string;
    t?: string;
    text: string;
    questions?: {
      question: string;
      options: string[];
      answer?: string;
      ownWords?: boolean;
    }[];
  }[];
  commands: {
    cmd: string;
    count: number;
    failures: number;
    isTest: boolean;
    isCheck?: boolean;
  }[];
  /**
   * Commands that reach the remote in this repository: a push or a PR made
   * (`publish`), or a look at CI (`ci`: `gh run …`, `gh pr checks`), in order,
   * at most 20. Older digests: absent.
   */
  remote?: {
    cmd: string;
    kind: 'publish' | 'ci';
    t?: string;
    failed: boolean;
    /** A `ci` look whose output shows CI or check results (pass/fail), not only pending. */
    results?: true;
    /** Commit shas (12 characters) that output names, when it shows results. */
    heads?: string[];
    /** Runner platforms (`Windows`, `macOS`, `Linux`, `arm64`) of jobs the output shows passing. */
    os?: string[];
    /** Runner platforms of jobs the output shows finished (passed or failed). */
    ranOs?: string[];
    /**
     * Workflow files the CI command ran or looked at: named by it
     * (`gh workflow run release.yml`, `--workflow ci.yml`) or by the run id it
     * watches, when an earlier command's output tied that id to a workflow.
     */
    workflows?: string[];
    /** A push whose command line committed first (`git commit … ; git push`): one action. */
    withCommit?: true;
  }[];
  /** Individual verification runs (tests, builds, linters, type checks, evals). */
  runs: Run[];
  milestones: string[];
  filesEdited: string[];
  discardedEdits: number;
  unknownRecordTypes: Record<string, number>;
}

/**
 * One verification run, as captured. `outcome` says what the log shows and
 * `basis` how we know: the command's exit status, its output, or neither (e.g.
 * a pipe hid the status). `revision` relates the run to the final change and is
 * never certified by timestamps alone:
 *  - `before later edits`: files in the PR were edited after this run;
 *  - `no later edits seen`: no normalized edit record to PR files followed it;
 *    shell writes and other unrecognized edits may be present even in the logs.
 *    This is a heuristic, not a freshness claim for prose;
 *  - `after later work`: it ran after the PR's last commit and after further
 *    edits to PR files, so it tested code that isn't this PR (the session kept
 *    going); it is not evidence about this PR either way;
 *  - `unknown`: no timestamp to compare.
 */
export interface Run {
  verificationBasis?: 'exact-content-receipt';
  id?: string;
  t?: string;
  cmd: string;
  kind: 'test' | 'build' | 'lint' | 'typecheck' | 'eval' | 'other';
  outcome: 'passed' | 'failed' | 'unknown';
  basis: 'exit status' | 'output' | 'none';
  /** Up to three result lines from the output, e.g. "96 pass", "0 fail". */
  summary: string[];
  revision: 'before later edits' | 'no later edits seen' | 'after later work' | 'unknown';
  /** PR files the session edited after this run (from the evidence graph): what it did not see. */
  laterEdits?: string[];
  /** Its exit status belongs to a later command: after a pipe, or after `;`. */
  masked?: 'pipe' | 'sequence';
  /** The only program its command runs (setup like `cd` aside). */
  sole?: true;
  /**
   * A reader can check its result against the log: its own runner result
   * lines, the only check in its command, an exit status not hidden by a pipe
   * or `;`, output neither truncated nor polled, and a folder in this repository.
   */
  statable?: true;
}

export interface TraceDigest {
  /** Exact-content receipts, distinguished from inferred historical log runs. */
  verification?: Run[];
  checksSha?: string;
  validation?: {
    name: string;
    command: string;
    outcome: string;
    current: boolean;
    reason?: string;
    durationMs: number;
  }[];
  v: 1;
  tool: string;
  generatedAt: string;
  repo: { owner?: string; name?: string };
  pr: {
    number?: number;
    url?: string;
    title?: string;
    base: string;
    head: string;
    mergeBase: string;
    usedWorkingTree: boolean;
    /** Uncommitted changes existed when the digest was made: runs may have tested code that isn't in the PR. */
    dirty?: boolean;
    commits: {
      sha: string;
      subject: string;
      /** Redacted commit explanation; attribute it to the commit when used. */
      body?: string;
      trailers: Record<string, string[]>;
      time?: string;
    }[];
  };
  stats: {
    filesChanged: number;
    added: number;
    removed: number;
    evidenceLines: number;
    agentMatchedPct: number;
    unmatchedPct: number;
    /** PR commits made during the included sessions (catches shell-driven edits). */
    commitsMadeInSessions: number;
    commits: number;
    /** How to read these numbers; they are Tracetoon's matching, not authorship. */
    about?: string;
  };
  sessions: DigestSession[];
  files: {
    path: string;
    /** What the file is for, to help point reviewers at the logic first. */
    role?: FileRole;
    added: number;
    removed: number;
    sessions: { ref: string; lines: number }[];
    unmatchedLines: number;
    /** Facts whose turns' edits survive in this file, strongest first (evidence graph). */
    facts?: string[];
    /** Check runs after the file's last captured edit, latest first, as `R4:passed`. */
    checksAfterLastEdit?: string[];
  }[];
  disclosure: {
    agents: string[];
    models: string[];
    suggestedTrailers: string[];
    existingTrailers: string[];
  };
  /** Provenance other tools recorded in the repo (Entire checkpoints, git-ai notes). */
  interop: Interop;
  privacy: { redactions: number; droppedForeignRecords: number; sessionIdsHashed: true };
  /** Other PR numbers the included sessions linked themselves to (Claude pr-link). */
  linkedPrs: number[];
  notes: string[];
  truncated: string[];
  /** Size of this run's evidence graph; ask it questions with `tracetoon query`. */
  graph?: {
    nodes: number;
    rels: number;
    hunks: number;
    linkedHunks: number;
    edits: number;
    deadEndEdits: number;
  };
}

/** Test runners, matched against the program at the start of a command segment. */
const TEST_RUNNERS = [
  /^(bun|npm|yarn|pnpm|deno)\s+(run\s+)?test\b/,
  /^npx\s+(jest|vitest|mocha|playwright\s+test)\b/,
  /^(python3?\s+-m\s+)?(pytest|unittest|tox|nox)\b/,
  /^(jest|vitest|mocha|rspec|phpunit|ctest)\b/,
  /^(go|cargo|dotnet|swift|mix|zig)\s+test\b/,
  /^(mvn|gradle|\.\/gradlew|gradlew)\b.*\btest\b/,
  /^make\s+(test|check)\b/,
  // A package script that runs the project's checks (`bun run check`, `npm run verify`);
  // `npm ci` and `bun ci` install, so `ci` needs `run`.
  /^(bun|npm|yarn|pnpm)\s+(run\s+(check|verify|validate|ci)|(check|verify|validate))(:\S+)?(?=\s|$)/,
  /^(node|deno)\s+(.*\s)?--test\b/,
];

/** Leading `NAME=value` assignments, quoted values included (`X="$(pwd)/a b"`). */
const ENV_PREFIX = /^([A-Z_][A-Z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+)+/;

/** Wrappers and launchers before the program a check runs, as written by agents. */
const LAUNCHERS = [
  /^(?:\(\s*)?(?:(?:time|env|exec|nohup|command)\s+)+/,
  /^(?:npx|bunx|pnpx)\s+(?:(?:-y|--yes|-q|--quiet|--no-install|--prefer-offline)\s+|(?:-p|--package)(?:=|\s+)\S+\s+)*/,
  /^(?:pnpm|yarn|npm)\s+(?:exec|dlx)\s+(?:--\s+)?/,
  /^(?:uv|poetry|pipenv|hatch|pdm)\s+run\s+/,
  // `yarn tsc`, `pnpm eslint`: a package manager running a check tool's binary.
  /^(?:yarn|pnpm)\s+(?=(?:tsc|eslint|prettier|biome|jest|vitest|mocha|playwright|pyright|shellcheck)\b)/,
];

/** Programs whose path-run binaries are named by the program they are. */
const RUNNER_PROGRAMS =
  'bun|node|deno|npm|npx|pnpm|yarn|cargo|go|python3?|pytest|tsc|eslint|jest|vitest|mocha|shellcheck|mypy|pyright|ruff|dotnet|swift|mix|zig|make';
const PATH_RUNNER = new RegExp(
  `^(?:~|[\\w.@+-]+)?(?:\\/[\\w.@+-]+)*\\/(?:[\\w.+]+[-_])?(${RUNNER_PROGRAMS})(?=\\s|$)`,
);

/**
 * A command segment reduced to the check it runs, for matching only (the run
 * keeps the segment as written): leading assignments, wrappers and launchers
 * (`npx --yes bun@1.4.0 test`, `uv run pytest`, `pnpm exec tsc`) are dropped,
 * a version pinned on the program (`bun@1.4.0`) too, and a program run from a
 * `bin` folder (`./node_modules/.bin/tsc`, `/home/u/.cargo/bin/cargo`) is
 * named by its file name.
 */
export function checkForm(seg: string): string {
  let s = seg.trim();
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s.replace(ENV_PREFIX, '');
    for (const re of LAUNCHERS) s = s.replace(re, '');
    // A version pinned on a launched package: `bun@1.4.0 test` → `bun test`.
    s = s.replace(/^((?:@[\w.-]+\/)?[\w.-]+)@[\w.^~<>=*-]+(?=\s|$)/, '$1');
    // A program from a `bin` folder, named by path.
    s = s.replace(/^(?:~|[\w.@+-]+)?(?:\/[\w.@+-]+)*\/\.?bin\/(?=[\w.-]+(\s|$))/, '');
    // A known runner's binary run by any other path, or a copy named for it
    // (`/tmp/x/bun test`, `/opt/tools/my-node --test`): named by that runner.
    s = s.replace(PATH_RUNNER, '$1');
    if (s === before) break;
  }
  return s;
}

/** The script a shell or interpreter runs (`sh -e dev/x.sh`), or a program run by its path. */
const SCRIPT =
  /^(?:(?:(?:sh|bash|zsh|dash)\s+(?:-[A-Za-mo-z]+\s+)*|(?:python3?|node|bun|deno)\s+(?:run\s+)?)(?=[^-\s])|(?=\.{0,2}\/|[\w.-]+\/))([^\s;&|<>]+)/;
const SCRIPT_FILE = /\/|\.(?:sh|bash|py|[cm]?[jt]s)$/;
const TEST_DIR = /^(?:tests?|smoke|e2e|__tests__)$/;
const TEST_STEM = /(?:^|[-_.])(?:tests?|smoke|e2e|spec)(?:[-_.]|$)/;

/**
 * A test or smoke script, run by a shell or an interpreter or directly by
 * its path: a `test`, `tests`, `smoke` or `e2e` folder on its path, or one of
 * those words as a part of its name (`dev/test-install.sh`, `run_tests.sh`).
 * A shell's `-n` (parse only) is a syntax check, not this.
 */
export function isTestScript(seg: string): boolean {
  const path = SCRIPT.exec(seg)?.[1];
  if (!path || !SCRIPT_FILE.test(path)) return false;
  const parts = path.split('/').filter((p) => p && p !== '.' && p !== '..');
  const stem = (parts.pop() ?? '').replace(/\.[A-Za-z]+$/, '');
  return parts.some((p) => TEST_DIR.test(p)) || TEST_STEM.test(stem);
}

const isTestRunner = (seg: string) => {
  const s = checkForm(seg);
  return TEST_RUNNERS.some((re) => re.test(s)) || isTestScript(s);
};

/**
 * A segment that runs a project script whose name says nothing about tests:
 * a package script (`bun run release`, `npm run gate`, `yarn prepublishOnly`),
 * a make target, or a script file (`./scripts/release.sh`, `bash ci/gate.sh`).
 * It can run the suite inside; only its output can show that.
 */
const PACKAGE_SCRIPT =
  /^(?:(?:bun|npm|pnpm)\s+run\s+[\w:.-]+|yarn\s+(?:run\s+)?(?!(?:add|install|remove|upgrade|init|create|dlx|exec|why|info)\b)[\w:.-]+|make\s+[\w.-]+)(?=\s|$)/;
export function isProjectScript(seg: string): boolean {
  const s = checkForm(seg);
  if (PACKAGE_SCRIPT.test(s)) return true;
  const path = SCRIPT.exec(s)?.[1];
  // The project's own scripts: a relative path, never a program elsewhere.
  return !!path && SCRIPT_FILE.test(path) && !/^[-/~$]/.test(path);
}

/**
 * A summary line only a test runner prints: bun's `Ran N tests across M files`,
 * jest's `Tests: …`, vitest's `Tests  N passed`, pytest's `=== N passed in 1.2s ===`,
 * mocha's `N passing (12ms)`, cargo's `test result: ok.`, go's `ok  pkg 0.1s`,
 * node's `# pass N`. A script that prints one ran a suite.
 */
const RUNNER_SUMMARY =
  /^\s*Ran \d+ tests? across \d+ files?\b|^\s*Tests?:\s+.*\b\d+ (?:passed|failed|total)\b|^\s*Tests\s+\d+ (?:passed|failed)\b|^=+ .*\b\d+ (?:passed|failed)\b.* in [\d.]+m?s\b|^\s*\d+ passing \(\d|^test result: (?:ok|FAILED)\. \d+ passed|^(?:ok|FAIL)\s+\S+\s+(?:[\d.]+s|\(cached\))\s*$|^# pass \d+\s*$/m;
export const hasRunnerSummary = (output: string | undefined): boolean =>
  RUNNER_SUMMARY.test(output ?? '');

/** Words of the PR's changed lines, once per line index. */
const prWordCache = new WeakMap<object, Set<string>>();
function prWordsOf(prSets: Map<string, Set<string>>): Set<string> {
  let w = prWordCache.get(prSets);
  if (!w) {
    w = new Set<string>();
    for (const lines of prSets.values())
      for (const l of lines) for (const x of outWords(l)) w.add(x);
    prWordCache.set(prSets, w);
  }
  return w;
}

/** The part of a chained command that runs tests, if any. */
export function testSegment(cmd: string): string | undefined {
  return openSegments(cmd)
    .map((s) => s.command.replace(ENV_PREFIX, ''))
    .find(isTestRunner);
}

export function isTestCommand(cmd: string): boolean {
  return testSegment(cmd) !== undefined;
}

/**
 * Whether test output reports failures. Needed because a piped run
 * (`bun test | tail`) exits with the last program's status, not the tests'.
 */
export function testOutputFailed(output: string | undefined): boolean {
  if (!output) return false;
  return (
    /(^|\s)([1-9]\d*) (fail|failed|failing|failures?)\b/im.test(output) || // bun, pytest, mocha, vitest
    /^Tests?:.*\b[1-9]\d* failed/im.test(output) || // jest
    /^(FAIL|not ok)\b/m.test(output) || // jest file lines, TAP
    /^test result: FAILED/m.test(output) || // cargo
    /^--- FAIL:/m.test(output) || // go
    /^\(fail\) /m.test(output) // bun's per-test failure lines
  );
}

export type FileRole = 'behavior' | 'tests' | 'docs' | 'config' | 'generated' | 'version';

/** A rough role for a changed file, from its path. */
export function fileRole(path: string): FileRole {
  const p = path.toLowerCase();
  if (isGeneratedPath(p)) return 'generated';
  if (/(^|\/)(version|version\.txt)$|(^|\/)src\/version\.ts$/.test(p)) return 'version';
  if (
    /(^|\/)(tests?|__tests__|spec|specs)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py|rs)$|(^|\/)test_[^/]+\.py$/.test(
      p,
    )
  )
    return 'tests';
  if (/\.(md|mdx|rst|txt|adoc)$|(^|\/)docs?\//.test(p)) return 'docs';
  if (
    /\.(json|ya?ml|toml|ini|cfg|lock)$|(^|\/)\.github\/|(^|\/)\.[a-z]+rc(\.[a-z]+)?$/.test(
      p,
    )
  )
    return 'config';
  return 'behavior';
}

const VERIFY: [Run['kind'], RegExp][] = [
  ['typecheck', /^((bun|npx|pnpm|yarn)\s+(x\s+)?)?(tsc|mypy|pyright|vue-tsc)\b/],
  [
    'typecheck',
    /^(bun|npm|pnpm|yarn)\s+(run\s+)?(typecheck|type-check|tsc)(:\S+)?(?=\s|$)/,
  ],
  [
    'lint',
    /^((bun|npx|pnpm|yarn)\s+(x\s+)?)?(eslint|prettier\s+(.*\s)?--check|ruff\s+(check|format\s+--check)|(@biomejs\/)?biome\s+(check|lint|ci)|clippy|golangci-lint|shellcheck|markdownlint|yamllint|actionlint|hadolint|flake8|pylint|stylelint)\b|^cargo\s+(clippy|fmt\s+(.*\s)?--check)\b|^go\s+vet\b|^gofmt\s+(?!.*\s-w\b)(-\S+\s+)*-l\b/,
  ],
  // Package scripts that lint or check formatting (`bun run lint`, `npm run format:check`).
  [
    'lint',
    /^(bun|npm|pnpm|yarn)\s+(run\s+)?(lint|format:check|fmt:check|check:format|prettier:check)(:\S+)?(?=\s|$)/,
  ],
  // Syntax and whitespace checks: `bash -n x.sh`, `shfmt -d`, `git diff --check`.
  [
    'lint',
    /^(sh|bash|zsh|dash|ksh)\s+(-\w+\s+)*-\w*n\w*\s|^shfmt\s+(?!.*\s-w\b)(.*\s)?(-[dl]|--?tojson)\b|^git\s+(-C\s+\S+\s+)?diff\b.*\s--check\b|^node\s+(--check|-c)\s|^python3?\s+-m\s+(py_compile|compileall)\b|^php\s+-l\b|^ruby\s+-c\b/,
  ],
  [
    'build',
    /^((bun|npm|pnpm|yarn)\s+run\s+(build|bundle|compile)\b|cargo\s+build\b|go\s+build\b|make(\s|$)|bun\s+build\b)/,
  ],
  ['eval', /^(bun|node|python3?|deno)\s+(run\s+)?\S*(eval|bench)\S*/],
];

/** The kind of check a non-test segment runs, if it is one. */
function verifyKind(seg: string): Run['kind'] | undefined {
  const s = checkForm(seg);
  return VERIFY.find(([, re]) => re.test(s))?.[0];
}

/** The part of a command that verifies something, and what kind of check it is. */
export function verificationSegment(
  cmd: string,
): { seg: string; kind: Run['kind'] } | undefined {
  const test = testSegment(cmd);
  if (test) return { seg: test, kind: 'test' };
  for (const s of openSegments(cmd).map((x) => x.command.replace(ENV_PREFIX, ''))) {
    const kind = verifyKind(s);
    if (kind) return { seg: s, kind };
  }
  return undefined;
}

/**
 * The verification run in one shell command, if any. Several test commands in
 * one shell command share one output, so it can't say which one failed: they
 * are listed together and the outcome is left unknown.
 */
export function commandRun(
  cmd: string,
  isError: boolean | undefined,
  output: string | undefined,
): Omit<Run, 'id' | 't' | 'revision'> | undefined {
  return commandRuns(cmd, isError, output)[0];
}

/** Output lines that belong to each kind of check, when one command runs several. */
const KIND_LINE: Partial<Record<Run['kind'], RegExp>> = {
  test: /(\b\d+\s+(pass|passed|passing|fail|failed|failing)\b|^Tests?:\s|\btest result:|^(FAIL|not ok)\b|^--- FAIL:|^\(fail\) )/i,
  typecheck: /(\bFound \d+ errors?\b|\berror TS\d+)/i,
  lint: /(All matched files use|\b\d+\s+(errors?|warnings?)\b|\bFound \d+ errors?)/i,
  build: /(\b\d+\s+(errors?|warnings?)\b|\bBundled\b|\bbuild (failed|succeeded)\b)/i,
  eval: /\b\d+\/\d+\s+checks?\b/i,
};

/**
 * Every verification run in one shell command, in order. Agents chain checks
 * (`bun run bundle; bun x tsc --noEmit && bun test; bun scripts/eval.ts`), and
 * each is a run in its own right: recording only one makes the others look
 * like they never happened. Test commands keep the rule above (one listed run).
 * With several checks the output is shared, so each run keeps only the result
 * lines of its own kind, and a failing exit status can't be pinned on one.
 */
export function commandRuns(
  cmd: string,
  isError: boolean | undefined,
  output: string | undefined,
  /**
   * Whether a script path (as the command names it) is one this PR adds or
   * changes: running it runs the PR's own check or harness.
   */
  prScript?: (path: string) => boolean,
): Omit<Run, 'id' | 't' | 'revision'>[] {
  // Wrappers opened: `docker run … sh -c '…'`, `xvfb-run`, `bash -c`, `timeout`.
  const parsed = openSegments(cmd);
  const segments = parsed.map((x) => x.command.replace(ENV_PREFIX, ''));
  // The command text a segment was split from (a wrapper's script), for
  // finding what follows it.
  const fromOf = (seg: string) => parsed[segments.indexOf(seg)]?.from ?? cmd;
  // A segment that sends its stdout to a file leaves no result in the log unless
  // a later segment reads that file back (`> out.log; grep pass out.log`); the
  // output captured then belongs to the other segments.
  const toFile = (s: string) => {
    const target = /(?:^|[^0-9&>])>{1,2}\s*(?!&)(\S+)/.exec(s)?.[1];
    if (!target) return false;
    const later = segments.slice(segments.indexOf(s) + 1);
    return !later.some((x) => x.includes(target));
  };
  const testSegments = segments.filter(isTestRunner);
  // No test command, but a project script (`bun run release`) whose output
  // shows a test runner's summary: the script ran the suite, so it is a test
  // run of its own. Only one such script, or the output can't be pinned on it.
  const scripts = testSegments.length
    ? []
    : segments.filter((x) => !verifyKind(x) && isProjectScript(x) && !toFile(x));
  const viaScript =
    scripts.length === 1 && hasRunnerSummary(output) ? scripts[0] : undefined;
  if (viaScript) testSegments.push(viaScript);
  const logged = testSegments.filter((s) => !toFile(s));
  const tests = logged.length ? logged : testSegments;
  const found: { seg: string; kind: Run['kind']; unlogged?: boolean; script?: true }[] =
    [];
  let testAdded = false;
  for (const seg of segments) {
    // A script this PR adds or changes, run by an interpreter or its path: the
    // PR's own harness or check, whatever its name says.
    const script =
      prScript && !isTestRunner(seg) && !verifyKind(seg) ? scriptPath(seg) : undefined;
    if (script && prScript!(script)) {
      found.push({ seg, kind: scriptKind(script), script: true });
      continue;
    }
    if (isTestRunner(seg) || seg === viaScript) {
      if (!tests.includes(seg)) {
        // Its results went to a file; record that it ran, not what it showed.
        found.push({ seg, kind: 'test', unlogged: true });
        continue;
      }
      if (!testAdded) found.push({ seg: tests[0]!, kind: 'test' });
      testAdded = true;
      continue;
    }
    const kind = verifyKind(seg);
    if (kind) found.push({ seg, kind });
  }
  const several = found.length > 1;
  // Any other program in the command may have printed result-like lines (an
  // unrecognized test binary, a script), so each check keeps only its kind's.
  // A script prints more than its suite (lint warnings, build counts), so its
  // run keeps only the test lines too.
  const shared =
    several || !!viaScript || segments.filter((s) => !SETUP_SEGMENT.test(s)).length > 1;
  const results = found.map(
    ({ seg, kind, unlogged, script }): Omit<Run, 'id' | 't' | 'revision'> => {
      if (unlogged)
        return { cmd: seg, kind, outcome: 'unknown', basis: 'none', summary: [] };
      if (script) {
        const masked = statusMask(fromOf(seg), seg);
        // Several checks in one command: a clean exit of a command whose
        // every program must succeed (`a && b && script`, no `;`, `|` or
        // `||`) is a clean exit of each, the script's too.
        const status = several
          ? isError === false && !masked && everyStepMustPass(cmd)
            ? false
            : undefined
          : isError;
        return {
          cmd: seg,
          kind,
          ...scriptOutcome(status, output, masked),
          ...(masked ? { masked } : {}),
          ...(several ? {} : { sole: true as const }),
        };
      }
      const own = shared
        ? (output ?? '')
            .split(/\r?\n/)
            .filter((l) => KIND_LINE[kind]?.test(l) ?? false)
            .join('\n')
        : output;
      const result = runOutcome(fromOf(seg), seg, isError, own, kind, output);
      if (several && result.basis === 'exit status' && result.outcome === 'failed')
        Object.assign(result, { outcome: 'unknown', basis: 'none' });
      // Several test commands' results are mixed in one output, so no count can
      // be pinned on either: list them with no result lines rather than let a
      // reader credit one suite with another's numbers.
      // The outcome is still clear when each of them reported zero failures.
      if (kind === 'test' && tests.length > 1) {
        // Every test command must have reported a failure count, all zero.
        const counts =
          (own ?? '').match(/\b\d+\s+(fail|failed|failing|failures?)\b/gi) ?? [];
        // A failure line in the shared output means one of them failed (no
        // count is pinned on either, but the run did not pass).
        const failed = testOutputFailed(own) || /^\(fail\) /m.test(output ?? '');
        const clean =
          counts.length >= tests.length && counts.every((c) => /^0\s/.test(c)) && !failed;
        return {
          cmd: tests.join(' ; '),
          kind,
          ...result,
          outcome: failed ? 'failed' : clean ? 'passed' : 'unknown',
          basis: failed || clean ? 'output' : 'none',
          summary: [],
        };
      }
      // An echoed status (`; echo "exit=$?"`) is the check's own: not masked.
      const masked =
        echoedStatus(fromOf(seg), seg, output) === undefined
          ? statusMask(fromOf(seg), seg)
          : undefined;
      return {
        cmd: seg,
        kind,
        ...result,
        ...(masked ? { masked } : {}),
        ...(shared ? {} : { sole: true as const }),
      };
    },
  );
  // A check that failed stops its `&&` chain: the checks after it never ran.
  const at = found.map(({ seg }) => segments.indexOf(seg));
  return results.filter(
    (_, i) =>
      !results.some(
        (r, j) =>
          j < i &&
          r.outcome === 'failed' &&
          at[j]! >= 0 &&
          at[j]! < at[i]! &&
          parsed
            .slice(at[j]! + 1, at[i]! + 1)
            .every((p) => p.before === '&&' || p.before === '|'),
      ),
  );
}

/** The script file a segment runs (`bun scripts/x.ts`, `./ci/gate.sh`, `python3 tools/y.py`), as written. */
export function scriptPath(seg: string): string | undefined {
  const s = checkForm(seg);
  const path = SCRIPT.exec(s)?.[1];
  if (!path || !SCRIPT_FILE.test(path) || /^[-~$]/.test(path)) return undefined;
  const rel = path.replace(/^\.\//, '');
  // A script: in a scripts/tools folder, or a shell script. The app's own
  // entry point (`bun src/cli.ts update`) is the program, not a check.
  return /(?:^|\/)(?:scripts?|bin|tools?|ci|dev|hack)\//.test(rel) ||
    /\.(?:sh|bash|zsh|ps1)$/.test(rel)
    ? rel
    : undefined;
}

/** A PR script's check kind by its name: a build or bundle script builds; anything else is a test run. */
function scriptKind(path: string): Run['kind'] {
  const stem = path
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '');
  if (/(?:^|[-_.])(?:build|bundle|compile|package)(?:[-_.]|$)/i.test(stem))
    return 'build';
  if (/(?:^|[-_.])(?:lint|check-format)(?:[-_.]|$)/i.test(stem)) return 'lint';
  return 'test';
}

/** A script's own tally: `163/163 steps, 2/2 smokes`, `12 passed, 0 failed`, `N/M checks passed`. */
const SCRIPT_TALLY =
  /\b\d+\s*\/\s*\d+\s+[A-Za-z][\w-]*|\b\d+\s+(?:pass(?:ed|es)?|fail(?:ed|ures?|s)?|ok|errors?)\b|\b(?:all|every)\s+\d+\s+\w+\s+passed\b/i;

/**
 * What a run of the PR's own script shows: its exit status when known (and
 * not masked), else its tally lines (every `N/M` complete and no failures:
 * passed; an incomplete `N/M` or a failure count: failed). The summary keeps
 * its last tally lines.
 */
export function scriptOutcome(
  isError: boolean | undefined,
  output: string | undefined,
  masked?: Run['masked'],
): Pick<Run, 'outcome' | 'basis' | 'summary'> {
  const summary = (output ?? '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => SCRIPT_TALLY.test(l) && !OUTPUT_HEADER.test(l))
    .slice(-2)
    .map((l) => l.slice(0, 160));
  if (isError !== undefined && !masked)
    return { outcome: isError ? 'failed' : 'passed', basis: 'exit status', summary };
  if (!summary.length) return { outcome: 'unknown', basis: 'none', summary };
  const last = summary.at(-1)!;
  // The script's own verdict word leads its tally line: `PASS … 163/163
  // steps, 0/2 smokes` passed (a skipped part is no failure), `FAIL …` failed.
  const verdict = /^(?:\W*)(PASS(?:ED)?|OK|SUCCESS|FAIL(?:ED|URE)?)\b/.exec(last)?.[1];
  if (verdict)
    return {
      outcome: /^FAIL/.test(verdict) ? 'failed' : 'passed',
      basis: 'output',
      summary,
    };
  const fractions = [...last.matchAll(/\b(\d+)\s*\/\s*(\d+)\s+[A-Za-z]/g)];
  const incomplete = fractions.some((m) => Number(m[1]) < Number(m[2]));
  const failures = /\b[1-9]\d*\s+(?:fail(?:ed|ures?|s)?|errors?)\b/i.test(last);
  return {
    outcome: incomplete || failures ? 'failed' : 'passed',
    basis: 'output',
    summary,
  };
}

/** A summary that is only an exit status, not a line the check printed. */
const PLACEHOLDER_RESULT = /^exit \d+(, no output)?$/;

/** Output the agent cut short: its own truncation markers. */
export function partialOutput(output: string | undefined): boolean {
  return /\bomitted \d+ of \d+ lines\b|\btokens? truncated\b|\[\.\.\.\s*\d+\s+(?:more\s+)?(?:lines?|chars?|characters|bytes)[^\]]*\]|\btruncated \d+ (?:lines?|chars?|characters|bytes)\b|\bOutput too large\b|<persisted-output>/i.test(
    output ?? '',
  );
}

/** Segments that set up a command and print no result: `cd x`, `export A=b`. */
const SETUP_SEGMENT = /^(?:cd|pushd|popd|export|unset|set|source|\.|true|:)(?:\s|$)/;

/** A test runner's count or summary line, never a typecheck's, lint's or build's result. */
const TEST_COUNT_LINE =
  /\b\d+\s+(pass|passed|passing|fail|failed|failing|tests?|skip|skipped|todo)\b|^Tests?:\s|\btest result:/i;

const RESULT_LINE =
  /(\b\d+\s+(pass|passed|passing|fail|failed|failing|errors?|warnings?)\b|\b\d+\/\d+\s+checks?\b|^Tests?:\s|\btest result:|All matched files use|Found \d+ errors?)/i;

/** Headers agents wrap a command's output in (Codex): not output of the command itself. */
const OUTPUT_HEADER =
  /^(Exit code:|Wall time:|Chunk ID:|Process exited with code|Original token count:|Output:|Total output lines:|\(no output\)$)/i;

/** Whether a command printed nothing (headers an agent adds aside). */
function silent(output: string | undefined): boolean {
  return (output ?? '')
    .split(/\r?\n/)
    .every((l) => !l.trim() || OUTPUT_HEADER.test(l.trim()));
}

/**
 * What hides a check's exit status in its command: a pipe after it (the
 * status is the last program's) or a `;` (the next command's). Undefined when
 * its status is its own or stops an `&&` chain.
 */
export function statusMask(cmd: string, seg: string): Run['masked'] {
  const after = cmd
    .slice(cmd.indexOf(seg) + seg.length)
    .replace(/\d*>&\d+/g, '') // redirections like 2>&1 aren't separators
    .trimStart();
  const m = /^(;|\|(?!\|))/.exec(after) ?? /^[^&|;]*(;|\|(?!\|))/.exec(after);
  return m ? (m[1] === ';' ? 'sequence' : 'pipe') : undefined;
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The exit status a command echoed for one of its checks, right after it:
 * `bun test; echo "exit=$?"`, or past a pipe `bun test | tail; echo
 * "exit=${PIPESTATUS[0]}"`. The echo needs a label (`exit=`, `exit code `),
 * and the output must hold that labelled line; a bare `echo $?` or a status
 * of a pipe's last program is not the check's. Undefined when not shown.
 */
export function echoedStatus(
  cmd: string,
  seg: string,
  output: string | undefined,
): number | undefined {
  const at = cmd.indexOf(seg);
  if (at < 0 || !output) return undefined;
  // After `a && check`, `$?` may be `a`'s failure.
  if (/&&\s*$/.test(cmd.slice(0, at))) return undefined;
  const after = cmd.slice(at + seg.length);
  const m =
    /^((?:\s*\d*>&\d+|\s*\d*>\s*\/dev\/null)*)(\s*\|[^;&|][^;&]*?)?\s*;\s*echo\s+("[^"\n]*"|'[^'\n]*'|[^;&|\n]+)/.exec(
      after,
    );
  if (!m) return undefined;
  // Single quotes print `$?` as is.
  if (m[3]!.startsWith("'")) return undefined;
  const arg = m[3]!.trim().replace(/^"(.*)"$/, '$1');
  const status = m[2] ? /\$\{PIPESTATUS\[0\]\}/ : /\$\?|\$\{\?\}/;
  const parts = arg.split(status);
  if (parts.length !== 2) return undefined;
  // A label of words around the status (`exit=`, `EXIT CODE:`), never a bare number.
  if (!/[a-z]{2,}/i.test(parts.join(''))) return undefined;
  const line = new RegExp(
    `^\\s*${escapeRe(parts[0]!.trim())}\\s*(\\d{1,3})\\s*${escapeRe(parts[1]!.trim())}\\s*$`,
  );
  const hit = output
    .split(/\r?\n/)
    .map((l) => line.exec(l)?.[1])
    .filter((x) => x !== undefined)
    .at(-1);
  return hit === undefined ? undefined : Number(hit);
}

/**
 * Whether a clean exit of the whole command means every program in it exited
 * cleanly: its programs are joined by `&&` only (no `;`, `||`, pipe or
 * background `&` outside quotes; redirections like `2>&1` aside).
 */
export function everyStepMustPass(cmd: string): boolean {
  const bare = cmd
    .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''")
    .replace(/\d*>&\d+|&>/g, '')
    .replace(/&&\s*\\?\n/g, ' ')
    .replace(/&&/g, ' ');
  return !/[;|&\n]|<</.test(bare.trim());
}

/** What a captured run shows, and how we know. */
export function runOutcome(
  cmd: string,
  seg: string,
  isError: boolean | undefined,
  output: string | undefined,
  kind: Run['kind'],
  /** The whole command's output, when `output` is only this check's share of it. */
  full?: string,
): Pick<Run, 'outcome' | 'basis' | 'summary'> {
  const summary = (output ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => RESULT_LINE.test(l) && (kind === 'test' || !TEST_COUNT_LINE.test(l)))
    .slice(-3)
    .map((l) => l.slice(0, 120));
  const isTest = kind === 'test';
  if (isTest && testOutputFailed(output))
    return { outcome: 'failed', basis: 'output', summary };
  // A compiler error in a typecheck's own output is a failure, whatever the exit status says.
  if (
    kind === 'typecheck' &&
    /\berror TS\d+|\bFound [1-9]\d* errors?\b/.test(output ?? '')
  )
    return { outcome: 'failed', basis: 'output', summary };
  // A failing check stops an && chain, so the tool reports an error. After
  // `;` or a pipe, the exit status belongs to a later command.
  // A status the command echoed for this check is its own exit status.
  const echoed = echoedStatus(cmd, seg, full ?? output);
  if (echoed !== undefined)
    return {
      outcome: echoed === 0 ? 'passed' : 'failed',
      basis: 'exit status',
      summary: summary.length ? summary : [`exit ${echoed}`],
    };
  const masked = !!statusMask(cmd, seg);
  // With the status masked, an error belongs to a later command (e.g. a grep
  // that found nothing), so judge by the output instead.
  if (isError === true && !masked)
    return { outcome: 'failed', basis: 'exit status', summary };
  if (!masked && isError === false) {
    // Linters, typecheckers and syntax checks pass silently: an empty output
    // with a clean exit is their result, said as such.
    if (!summary.length && (kind === 'lint' || kind === 'typecheck'))
      return {
        outcome: 'passed',
        basis: 'exit status',
        summary: [silent(full ?? output) ? 'exit 0, no output' : 'exit 0'],
      };
    return { outcome: 'passed', basis: 'exit status', summary };
  }
  if (
    summary.length &&
    !summary.some((l) => /\b[1-9]\d*\s+(fail|failed|failing|errors?)\b/i.test(l))
  )
    return { outcome: 'passed', basis: 'output', summary };
  return { outcome: 'unknown', basis: 'none', summary };
}

/** A path-like token: has a folder or an extension, no shell expansion. */
const PATHLIKE = /^(?![-$])[\w@~./+-]*(?:\/[\w@.+-]+|\.\w{1,8})$/;
const unquote = (t: string) => t.replace(/^(["'])(.*)\1$/, '$2');

/**
 * Files a shell command writes, as written in it: redirections (`cat > f`,
 * `> f`, `>> f`), `tee f`, `sed -i … f` / `perl -pi … f`, and quoted paths in
 * an inline script that opens files for writing (`python3 - <<EOF … open(p,
 * 'w').write(…)`, `write_text`, `writeFileSync`). Conservative: only
 * path-like tokens; the caller keeps the PR's own files.
 */
export function shellWriteTargets(cmd: string): string[] {
  const out = new Set<string>();
  // Heredoc bodies hold script text, not commands: the first line only for redirections.
  const lines = cmd.split('\n');
  const head = lines[0] ?? '';
  for (const m of head.matchAll(
    /(?:^|[^0-9&>])>{1,2}\s*(?!&)("[^"]+"|'[^']+'|[^\s;&|<>()]+)/g,
  )) {
    const t = unquote(m[1]!);
    if (t !== '/dev/null' && PATHLIKE.test(t)) out.add(t);
  }
  for (const seg of splitCommands(head)) {
    const toks = seg.trim().replace(ENV_PREFIX, '').split(/\s+/);
    const prog = toks[0] ?? '';
    const args = toks.slice(1).filter((t) => !/^\d?[<>]/.test(t));
    if (prog === 'tee')
      for (const t of args.filter((x) => !x.startsWith('-')).map(unquote))
        if (PATHLIKE.test(t)) out.add(t);
    const inPlace =
      (prog === 'sed' &&
        args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place')) ||
      (prog === 'perl' && args.some((a) => /^-[a-zA-Z]*i/.test(a)));
    if (inPlace) {
      const last = unquote(args.at(-1) ?? '');
      if (PATHLIKE.test(last)) out.add(last);
    }
  }
  // An inline script that writes files: its quoted path literals.
  if (
    /\bopen\([^)]*,\s*['"][wa]\+?['"]|\.write_text\(|\bwriteFileSync\(|\bBun\.write\(/.test(
      cmd,
    ) &&
    /^\s*(?:\S+=\S+\s+)*(?:python3?|node|bun|deno|ruby|perl)\b/.test(head)
  )
    for (const m of cmd.matchAll(/(["'])([^"'\s]+)\1/g))
      if (PATHLIKE.test(m[2]!) && m[2]!.includes('.')) out.add(m[2]!);
  return [...out];
}

/** A short grouping key for a shell command: the program and its first argument. */
export function commandKey(cmd: string): string {
  const segments = splitCommands(cmd).filter((s) => !/^(cd|set|export|pushd)\b/.test(s));
  const first = segments[0] ?? cmd.trim();
  const tokens = first
    .replace(ENV_PREFIX, '')
    .split(/\s+/)
    .filter((t) => !/^(-|<|>|\d>)/.test(t)); // flags, heredocs and redirections
  return tokens.slice(0, 2).join(' ') || first.slice(0, 40);
}

export function hashId(salt: string, id: string): string {
  return 'h:' + createHash('sha256').update(`${salt}\0${id}`).digest('hex').slice(0, 12);
}

/**
 * What happened in a session, in order, keeping the turn each fact and edit
 * belongs to. Only the evidence graph reads it; it is never written out, and its
 * edit lines (normalized PR lines, used to find the hunks an edit survives in)
 * never leave memory.
 */
export type TrailEvent =
  | { kind: 'prompt'; fact: DigestSession['prompts'][number] }
  | { kind: 'decision'; fact: DigestSession['decisions'][number] }
  | { kind: 'plan'; fact: DigestSession['plans'][number] }
  | { kind: 'run'; fact: Run }
  | {
      kind: 'edit';
      t?: string;
      /** Repo-relative, redacted. */
      file: string;
      inPr: boolean;
      /** Normalized added lines that are also added by the PR. */
      lines: string[];
      added: number;
      removed: number;
      via?: 'shell';
      /** Read from the command's text (`sed -i f`, `> f`): no lines recorded. */
      inferred?: true;
    };

export interface SessionTrail {
  ref: string;
  events: TrailEvent[];
  /** Commands other than checks that ran the project's own code (see `invocationsOf`). */
  invocations?: Invocation[];
}

/**
 * A command other than a check or a file utility, as plain words: the program
 * and its arguments without flags, assignments, quotes or redirections
 * (`bun src/cli.ts comic art codex`), and the words of its output that the
 * PR's own changed lines also contain. Only the evidence graph reads it.
 */
export interface Invocation {
  t?: string;
  cmd: string;
  out: string[];
  /** It ran in another folder than this repository's (see `runsInRepo`). */
  elsewhere?: true;
}

const PUBLISH_CMD = /^git\s+(?:-C\s+\S+\s+)?push\b|^gh\s+pr\s+(?:create|ready|merge)\b/;
const CI_CMD = /^gh\s+(?:run\s+(?:view|watch|list|rerun)|pr\s+checks|workflow\s+run)\b/;
/** Commands that may show check results in their output (`gh pr view --json statusCheckRollup`, `gh api …/check-runs`). */
const CI_MAYBE_CMD = /^gh\s+(?:pr\s+(?:view|status)|api)\b/;
/**
 * Output that shows a CI or check result: `gh pr checks` rows (`name<TAB>pass`)
 * and summaries, run conclusions in JSON or text, a failed run's log.
 */
const CI_RESULT =
  /\t(?:pass|fail|failure|success)\t|\b[1-9]\d* (?:successful|failing|failed|passing)\b|\bAll checks (?:were successful|have passed)\b|\bSome checks were not successful\b|"(?:conclusion|bucket|state)"\s*:\s*"(?:success|failure|pass|fail|SUCCESS|FAILURE|timed_out|TIMED_OUT|cancelled|CANCELLED)"|\bcompleted with '(?:success|failure)'|\bconclusion:\s*(?:success|failure)\b|^[✓✗X] .+ (?:in \d|·)|##\[error\]/m;

/**
 * Whether a CI look's output shows results, and the commit shas it names
 * (12 characters), for `results`/`heads` of a remote entry.
 */
export function ciResults(output: string | undefined): {
  results?: true;
  heads?: string[];
  os?: string[];
} {
  if (!output || !CI_RESULT.test(output)) return {};
  const heads = [
    ...new Set([...output.matchAll(/\b[0-9a-f]{40}\b/g)].map((m) => m[0].slice(0, 12))),
  ];
  const os = passingRunnerOs(output);
  const ranOs = finishedRunnerOs(output);
  return {
    results: true,
    ...(heads.length ? { heads: heads.slice(0, 12) } : {}),
    ...(os.length ? { os } : {}),
    ...(ranOs.length && ranOs.join() !== os.join() ? { ranOs } : {}),
  };
}

/**
 * Runner platforms of the jobs a CI look shows finished, passed or failed
 * (a pending or queued job did not run yet).
 */
export function finishedRunnerOs(output: string): string[] {
  const out = new Set<string>();
  const lines = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n|\r/);
  for (const line of lines) {
    const labels = [...line.matchAll(RUNNER_LABEL)];
    if (!labels.length) continue;
    const done =
      JOB_PASSED.test(line) ||
      /^\s*[✗✘X]\s|\tfail(?:ed|ure)?\t|\bfail(?:ed|ure)\b/i.test(line);
    if (!done || /\bpending\b|\bqueued\b|\bin_progress\b/i.test(line)) continue;
    for (const m of labels) {
      const k = m[1]!.toLowerCase();
      out.add(k === 'windows' ? 'Windows' : k === 'macos' ? 'macOS' : 'Linux');
      if (m[2]) out.add('arm64');
    }
  }
  return [...out].sort();
}

/** A workflow file a CI command names: `gh workflow run <file>`, `--workflow <file>`, `-w <file>`. */
const WORKFLOW_ARG =
  /^gh\s+workflow\s+run\s+(?:-\S+\s+\S+\s+)*([\w.-]+\.ya?ml)\b|\s(?:--workflow|-w)(?:=|\s+)['"]?([\w.-]+\.ya?ml)\b/;
/** A run id a CI command names: `gh run watch|view|rerun|download <id>`. */
const RUN_ID_ARG =
  /^gh\s+run\s+(?:watch|view|rerun|download|cancel)\s+(?:-\S+\s+)*(\d{5,})\b/;
/** Run ids an output names: `"databaseId":N`, `.../actions/runs/N`. */
const RUN_ID_OUT = /"databaseId"\s*:\s*(\d{5,})|\/actions\/runs\/(\d{5,})/g;

/** The workflow file and run id one command segment names, if any. */
export function ciTargetOf(seg: string): { workflow?: string; run?: string } {
  const w = WORKFLOW_ARG.exec(seg);
  const r = RUN_ID_ARG.exec(seg);
  return {
    ...(w ? { workflow: (w[1] ?? w[2])! } : {}),
    ...(r ? { run: r[1]! } : {}),
  };
}

/** Run ids an output names. */
export function runIdsIn(output: string | undefined): string[] {
  return [
    ...new Set([...(output ?? '').matchAll(RUN_ID_OUT)].map((m) => (m[1] ?? m[2])!)),
  ];
}

/** A runner label a job runs on (`windows-latest`, `macos-14`, `ubuntu-24.04-arm`). */
const RUNNER_LABEL = /\b(windows|macos|ubuntu)-(?:latest|\d[\w.]*)(-arm(?:64)?)?\b/gi;
/** A job line that passed: `✓ build (windows-latest) in 1m`, `name\tpass\t…`, a success conclusion. */
const JOB_PASSED = /^\s*[✓✔]|\tpass(?:ed)?\t|\bsuccess(?:ful)?\b/i;
const JOB_FAILED =
  /^\s*[✗✘X*]\s|\tfail(?:ed|ure)?\t|\bfail(?:ed|ure)?\b|\bcancell?ed\b|\bpending\b/i;

/**
 * Runner platforms of the jobs a CI look shows passing, from runner labels in
 * job lines (`CI/check (windows-latest)`), when every line naming that
 * platform passed. Names follow the brief's platform names.
 */
export function passingRunnerOs(output: string): string[] {
  const passed = new Set<string>();
  const failed = new Set<string>();
  // The last refresh of a watched look is what counts: later lines replace earlier ones.
  const lines = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n|\r/);
  const last = new Map<string, boolean>();
  for (const line of lines) {
    const labels = [...line.matchAll(RUNNER_LABEL)];
    if (!labels.length) continue;
    const ok =
      JOB_PASSED.test(line) && !JOB_FAILED.test(line.replace(/\bfail(?:ing|ed)?,/g, ''));
    for (const m of labels) {
      const name =
        m[1]!.toLowerCase() === 'windows'
          ? 'Windows'
          : m[1]!.toLowerCase() === 'macos'
            ? 'macOS'
            : 'Linux';
      last.set(
        `${line
          .split(m[0])[0]!
          .replace(/^\s*\S\s+/, '')
          .trim()}|${name}`,
        ok,
      );
      if (m[2]) last.set(`${line.split(m[0])[0]!.trim()}|arm64`, ok);
    }
  }
  for (const [k, ok] of last) (ok ? passed : failed).add(k.split('|').pop()!);
  return [...passed].filter((x) => !failed.has(x)).sort();
}

/**
 * The segments of a command that push, open a PR, or look at CI, as their
 * program and subcommand (`git push`, `gh pr create`, `gh run view`).
 */
export function remoteCommands(
  cmd: string,
  output?: string,
): { cmd: string; kind: 'publish' | 'ci' }[] {
  const out: { cmd: string; kind: 'publish' | 'ci' }[] = [];
  for (const raw of splitCommands(cmd)) {
    const seg = raw.replace(ENV_PREFIX, '').replace(WRAPPER, '').trim();
    const kind = PUBLISH_CMD.test(seg)
      ? 'publish'
      : CI_CMD.test(seg) ||
          (output !== undefined && CI_MAYBE_CMD.test(seg) && CI_RESULT.test(output))
        ? 'ci'
        : undefined;
    if (!kind) continue;
    const words = seg.split(/\s+/).filter((w) => !w.startsWith('-'));
    // `gh api` names its endpoint next: an owner, a repo, run ids. Never kept.
    const n = words[1] === 'api' ? 2 : 3;
    out.push({
      cmd: seg.startsWith('git') ? 'git push' : words.slice(0, n).join(' '),
      kind,
    });
  }
  return out;
}

/**
 * Whether a command line commits before its push (`git commit -m x && git
 * push`, `git commit …; git push`): the commit and the push are one action.
 */
export function commitsBefore(cmd: string, push: string): boolean {
  if (!/^git push\b/.test(push)) return false;
  const segs = splitCommands(cmd).map((x) =>
    x.replace(ENV_PREFIX, '').replace(WRAPPER, '').trim(),
  );
  const p = segs.findIndex((x) => /^git\s+(?:-C\s+\S+\s+)?push\b/.test(x));
  return p > 0 && segs.slice(0, p).some((x) => /^git\s+(?:-C\s+\S+\s+)?commit\b/.test(x));
}

/**
 * At most 20 remote entries, in order: every push and PR made (the last
 * push matters most), then the latest CI looks. A long CI watch loop no
 * longer crowds out a push that came after it.
 */
export function keptRemote<T extends { kind: string }>(remote: T[], max = 20): T[] {
  if (remote.length <= max) return remote;
  const publish = remote.filter((x) => x.kind === 'publish').slice(-max);
  let room = max - publish.length;
  const keep = new Set<T>(publish);
  for (let i = remote.length - 1; i >= 0 && room > 0; i--)
    if (!keep.has(remote[i]!)) {
      keep.add(remote[i]!);
      room--;
    }
  return remote.filter((x) => keep.has(x));
}

/** Programs that read, move or inspect files: running one runs none of the project's code. */
const UTILITY =
  /^(for|while|until|if|then|else|do|done|fi|case|esac|function|\[\[?|cd|pushd|popd|ls|dir|cat|type|sed|awk|grep|egrep|rg|ag|head|tail|less|more|wc|echo|printf|git|gh|find|fd|which|where|whereis|command|test|true|false|sleep|mkdir|rmdir|rm|cp|mv|ln|touch|chmod|chown|diff|cmp|sort|uniq|cut|tr|xargs|tee|jq|yq|curl|wget|tar|zip|unzip|stat|file|du|df|ps|kill|pwd|export|set|unset|source|\.|read|exit|wait|history|clear|date|open|start|explorer|code|vim|nano|python3?\s+-c|node\s+-e|bun\s+-e)(?=\s|$)/;
/** Wrappers before the real program. */
const WRAPPER = /^(?:\(\s*)?(?:(?:time|env|exec|nohup|sudo|command)\s+)+/;
const outWords = (s: string) =>
  (s.match(/[A-Za-z][a-z]+|[A-Z]+(?![a-z])/g) ?? [])
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3);

/** The non-check segments of a command that run something, as `Invocation`s. */
export function invocationsOf(
  cmd: string,
  output: string | undefined,
  prWords: Set<string>,
  scrub: Scrubber,
): Omit<Invocation, 't'>[] {
  const out: Omit<Invocation, 't'>[] = [];
  for (const raw of splitCommands(cmd)) {
    const seg = raw.replace(ENV_PREFIX, '').replace(WRAPPER, '').trim();
    if (!seg || UTILITY.test(seg)) continue;
    if (isTestRunner(seg) || verifyKind(seg)) continue;
    const words: string[] = [];
    for (const tok of seg.split(/\s+/)) {
      if (/^\d?[<>|&;]/.test(tok)) break; // redirections and what follows
      const t = tok.replace(/\)+$/, '');
      if (!t || t.startsWith('-') || /[=<>|&;"'`$(){}\\]/.test(t)) continue;
      // Long mixed tokens may be keys or ids: never kept.
      if (t.length >= 20 && /\d/.test(t) && /[A-Za-z]/.test(t) && !/[./]/.test(t))
        continue;
      words.push(t);
      if (words.length >= 10) break;
    }
    if (words.length < 2) continue;
    out.push({
      cmd: clip(scrub.text(words.join(' ')), 120),
      out: [...new Set(outWords(output ?? '').filter((w) => prWords.has(w)))].slice(
        0,
        40,
      ),
    });
  }
  return out;
}

/** Every user-typed prompt in the session log (see `DigestSession.userPrompts`). */
function userPromptsOf(
  records: TraceRecord[] = [],
): NonNullable<DigestSession['userPrompts']> {
  const typed = records.filter(
    (r): r is Extract<TraceRecord, { kind: 'prompt' }> =>
      r.kind === 'prompt' && !r.delegated,
  );
  const first = typed[0];
  return {
    count: typed.length,
    ...(first?.ts ? { firstT: first.ts } : {}),
  };
}

function sessionDigest(
  m: SessionMatch,
  ref: string,
  truth: PrTruth,
  prSets: Map<string, Set<string>>,
  scrub: Scrubber,
  trail: TrailEvent[] = [],
  invocations: Invocation[] = [],
): DigestSession {
  const recs = m.kept;
  const models = new Set<string>();
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let sawUsage = false;
  const prompts: DigestSession['prompts'] = [];
  const delegations: DigestSession['delegations'] = [];
  const artifacts: DigestSession['artifacts'] = [];
  const plans: DigestSession['plans'] = [];
  const decisions: DigestSession['decisions'] = [];
  const cmdGroups = new Map<
    string,
    { count: number; failures: number; isTest: boolean; isCheck?: boolean }
  >();
  // A script this PR adds or changes, as a command names it.
  const prPaths = truth.files.map((f) => f.path);
  const prScript = (path: string) =>
    prPaths.some((f) => f === path || f.endsWith(`/${path}`) || path.endsWith(`/${f}`));
  const milestones: string[] = [];
  const runs: Run[] = [];
  /** Invocations past the first 60: the last 20 are kept. */
  const latest: Invocation[] = [];
  const files = new Set<string>();
  let testFailedEarlier = false;
  const remote: NonNullable<DigestSession['remote']> = [];
  // This repository's names, for `gh … --repo owner/name` run elsewhere.
  const names = repoNames(truth.remote?.name, m.roots);
  /** Run id → the workflow file a command that started or listed it named. */
  const runWorkflow = new Map<string, string>();
  /**
   * A command's pushes, PRs made and CI looks (`remote`). `here` false: run
   * from another folder but naming this repository (`--repo owner/<name>`),
   * so only its CI looks count (a push there pushed that clone's branch).
   */
  const recordRemote = (
    r: { cmd: string; ts?: string; output?: string; isError?: boolean },
    here: boolean,
  ) => {
    // Workflows the command names, and run ids its output ties to them.
    const targets = splitCommands(r.cmd).map((x) =>
      ciTargetOf(x.replace(ENV_PREFIX, '').replace(WRAPPER, '').trim()),
    );
    const named = [...new Set(targets.flatMap((x) => (x.workflow ? [x.workflow] : [])))];
    if (named.length === 1)
      for (const id of runIdsIn(r.output))
        if (!runWorkflow.has(id)) runWorkflow.set(id, named[0]!);
    const watched = targets.flatMap((x) =>
      x.run && runWorkflow.has(x.run) ? [runWorkflow.get(x.run)!] : [],
    );
    const workflows = [...new Set([...named, ...watched])];
    for (const x of remoteCommands(r.cmd, r.output))
      // From another folder only the CI look is this repository's (a
      // push there pushed that clone's branch).
      if (here || x.kind === 'ci')
        remote.push({
          ...x,
          ...(r.ts ? { t: r.ts } : {}),
          failed: r.isError === true,
          ...(x.kind === 'ci' ? ciResults(r.output) : {}),
          ...(x.kind === 'ci' && workflows.length ? { workflows } : {}),
          ...(x.kind === 'publish' && commitsBefore(r.cmd, x.cmd)
            ? { withCommit: true as const }
            : {}),
        });
  };
  let current: { ledToEdits: boolean } | undefined;
  // Files a shell command's own diff (Claude Code's `bashEditDiff`) already records.
  const shellDiffed = new Set(
    recs.flatMap((r) =>
      r.kind === 'edit' && r.via === 'shell' ? [`${r.ts ?? ''}|${r.file}`] : [],
    ),
  );
  /** Times of PR-file writes read from a command's text (no diff recorded). */
  const inferredWrites: string[] = [];

  for (const r of recs) {
    if (r.model && !r.model.startsWith('<')) models.add(r.model);
    switch (r.kind) {
      case 'prompt': {
        if (r.delegated) {
          delegations.push({ t: r.ts, text: clip(scrub.text(r.text), 200) });
          break;
        }
        const p: DigestSession['prompts'][number] = {
          t: r.ts,
          text: scrub.text(r.text),
          ledToEdits: false,
          ...(r.feedback ? { pushback: true } : {}),
        };
        prompts.push(p);
        trail.push({ kind: 'prompt', fact: p });
        current = p;
        break;
      }
      case 'assistant':
        if (r.model) models.add(r.model);
        break;
      case 'usage':
        if (r.model && !r.model.startsWith('<')) models.add(r.model);
        usage.input += r.usage.input;
        usage.output += r.usage.output;
        usage.cacheRead += r.usage.cacheRead;
        usage.cacheWrite += r.usage.cacheWrite;
        sawUsage = true;
        break;
      case 'plan': {
        const plan = {
          t: r.ts,
          approved: r.approved,
          excerpt: scrub.text(r.markdown),
        };
        plans.push(plan);
        trail.push({ kind: 'plan', fact: plan });
        if (r.approved) milestones.push('plan approved');
        break;
      }
      case 'decision': {
        const decision: DigestSession['decisions'][number] = {
          t: r.ts,
          text: scrub.text(r.text),
          ...(r.questions?.length
            ? {
                questions: r.questions.map((q) => ({
                  question: scrub.text(q.question),
                  options: q.options.map((o) => scrub.text(o)),
                  ...(q.answer !== undefined
                    ? {
                        answer: scrub.text(q.answer),
                      }
                    : {}),
                  ...(q.ownWords !== undefined ? { ownWords: q.ownWords } : {}),
                })),
              }
            : {}),
        };
        decisions.push(decision);
        trail.push({ kind: 'decision', fact: decision });
        break;
      }
      case 'edit': {
        const rel = repoRel({ roots: m.roots }, r.file);
        if (rel) files.add(rel);
        const set = rel ? prSets.get(rel) : undefined;
        const surviving = set
          ? r.added.flatMap((l) => {
              const e = evidenceLine(l);
              return e && set.has(e) ? [e] : [];
            })
          : [];
        if (current && surviving.length) current.ledToEdits = true;
        if (rel)
          trail.push({
            kind: 'edit',
            t: r.ts,
            file: scrub.text(rel),
            inPr: !!set,
            lines: surviving,
            added: r.added.length,
            removed: r.removed.length,
            ...(r.via ? { via: r.via } : {}),
          });
        break;
      }
      case 'command': {
        if (r.orphan) {
          // A test runner's result whose command the log lacks: a run with no command.
          if (!runsInRepo('', r.cwd, m.roots)) break;
          const fact: Run = {
            t: r.ts,
            cmd: ORPHAN_COMMAND,
            kind: 'test',
            ...runOutcome(ORPHAN_COMMAND, ORPHAN_COMMAND, r.isError, r.output, 'test'),
            revision: 'unknown',
          };
          fact.summary = fact.summary.map((line) => scrub.text(line));
          runs.push(fact);
          trail.push({ kind: 'run', fact });
          break;
        }
        // Another repository's checks (`cd ../other && bun test`) say nothing of this PR.
        const here = runsInRepo(r.cmd, r.cwd, m.roots);
        // A CI look at this repository from another folder (a scratch clone,
        // the folder above the checkout): its CI part only.
        if (
          (!here || (!!r.cwd && !provablyInRepo(r.cmd, r.cwd, m.roots))) &&
          ghTargetsRepo(r.cmd, names)
        ) {
          recordRemote(r, false);
          break;
        }
        for (const x of invocationsOf(r.cmd, r.output, prWordsOf(prSets), scrub)) {
          const inv = { t: r.ts, ...x, ...(here ? {} : { elsewhere: true as const }) };
          if (invocations.length < 60) invocations.push(inv);
          // The session's last commands matter too: what ran after the last edit.
          else if (latest.push(inv) > 20) latest.shift();
        }
        // Proof the run is this repository's, not just no proof it isn't.
        const provable = here && provablyInRepo(r.cmd, r.cwd, m.roots);
        const cmdRuns = here ? commandRuns(r.cmd, r.isError, r.output, prScript) : [];
        for (const run of cmdRuns) {
          const fact: Run = {
            t: r.ts,
            ...run,
            cmd: scrub.text(run.cmd),
            summary: run.summary.map((line) => scrub.text(line)),
            revision: 'unknown',
          };
          if (
            provable &&
            run.sole &&
            !run.masked &&
            r.isError !== undefined &&
            !r.partial &&
            !partialOutput(r.output) &&
            (run.outcome === 'passed' || run.outcome === 'failed') &&
            run.summary.some((l) => !PLACEHOLDER_RESULT.test(l))
          )
            fact.statable = true;
          runs.push(fact);
          trail.push({ kind: 'run', fact });
        }
        // A PR file the command wrote (`sed -i`, `> f`, a heredoc script)
        // with no diff in the log: an edit with no lines, so a run before it
        // isn't taken to have seen the committed content.
        if (here && r.isError !== true)
          for (const target of shellWriteTargets(r.cmd)) {
            const file = resolve(r.cwd ?? '.', target);
            const rel = repoRel({ roots: m.roots }, file);
            if (!rel || !prSets.has(rel) || shellDiffed.has(`${r.ts ?? ''}|${file}`))
              continue;
            if (r.ts) inferredWrites.push(r.ts);
            trail.push({
              kind: 'edit',
              t: r.ts,
              file: scrub.text(rel),
              inPr: true,
              lines: [],
              added: 0,
              removed: 0,
              via: 'shell',
              inferred: true,
            });
          }
        if (here) recordRemote(r, true);
        const seg = testSegment(r.cmd);
        const test = seg !== undefined;
        const key = clip(scrub.text(commandKey(seg ?? r.cmd)), 60);
        const failed = r.isError === true || (test && testOutputFailed(r.output));
        const g = cmdGroups.get(key) ?? { count: 0, failures: 0, isTest: test };
        // A command that ran a recognized check is a check run, not a failed command.
        if (cmdRuns.some((x) => x.kind !== 'other')) g.isCheck = true;
        g.count++;
        if (failed) g.failures++;
        cmdGroups.set(key, g);
        if (test && failed) testFailedEarlier = true;
        if (test && !failed && testFailedEarlier) {
          milestones.push('tests went from failing to passing');
          testFailedEarlier = false;
        }
        break;
      }
      case 'link':
        if (r.prNumber) milestones.push(`linked to PR #${r.prNumber}`);
        break;
      case 'artifact':
        artifacts.push({
          name: r.name,
          summary: r.summary ? clip(scrub.text(r.summary), 300) : undefined,
          excerpt: clip(scrub.text(r.markdown), 1500),
        });
        break;
    }
  }
  invocations.push(...latest);
  // Relate each run to later edits of files in the PR (never certifies a revision).
  const prEditTimes = recs
    .filter((r) => r.kind === 'edit' && r.ts)
    .filter((r) => {
      const rel = repoRel({ roots: m.roots }, (r as { file: string }).file);
      return !!rel && prSets.has(rel);
    })
    .map((r) => Date.parse(r.ts!))
    .concat(inferredWrites.map((t) => Date.parse(t)));
  // The PR's last commit, when it is a committed range (not the working tree).
  const headTime = truth.usedWorkingTree
    ? undefined
    : Math.max(0, ...truth.commits.map((c) => c.commitTime ?? 0)) || undefined;
  for (const run of runs) {
    if (!run.t) continue;
    const at = Date.parse(run.t);
    run.revision =
      headTime !== undefined &&
      at > headTime &&
      prEditTimes.some((e) => e > headTime && e < at)
        ? 'after later work'
        : prEditTimes.some((e) => e > at)
          ? 'before later edits'
          : 'no later edits seen';
  }
  if (files.size) milestones.push(`edited ${files.size} file(s)`);
  if (m.commitsMade.length)
    milestones.push(`made ${m.commitsMade.length} of the PR's commits`);
  if (m.discardedEdits)
    milestones.push(`${m.discardedEdits} edit(s) did not survive into the PR`);

  const times = recs
    .map((r) => r.ts)
    .filter((t): t is string => !!t)
    .sort();
  return {
    ref,
    agent: traceLabel(m.session.agent),
    title: m.session.title ? clip(scrub.text(m.session.title), 80) : undefined,
    models: [...models],
    span: { start: times[0], end: times[times.length - 1] },
    usage: sawUsage ? usage : null,
    sessionCostUsd: m.session.sessionCostUsd,
    score: m.score,
    band: m.band === 'included' ? 'included' : 'ambiguous',
    reasons: m.reasons,
    prompts,
    userPrompts: userPromptsOf(m.session.records),
    delegations: delegations.slice(0, 10),
    commitsMade: m.commitsMade.map((s) => s.slice(0, 12)),
    plans,
    artifacts,
    decisions,
    runs,
    ...(remote.length ? { remote: keptRemote(remote) } : {}),
    commands: [...cmdGroups.entries()]
      .map(([cmd, g]) => ({ cmd, ...g }))
      .sort((a, b) => Number(b.isTest) - Number(a.isTest) || b.count - a.count)
      .slice(0, 15),
    milestones: [...new Set(milestones)],
    filesEdited: [...files].sort(),
    discardedEdits: m.discardedEdits,
    unknownRecordTypes: m.session.unknownTypes,
  };
}

const estimateTokens = (o: unknown) => Math.ceil(JSON.stringify(o).length / 4);

/** Fact id → how much of the PR it explains (from the evidence graph). */
export type Relevance = Record<string, number>;

/** The `n` most relevant runs (newest first among equals), in their original order. */
function topRuns(runs: Run[], relevance: Relevance, n: number): Run[] {
  const keep = new Set(
    runs
      .map((r, i) => ({ r, i }))
      .sort(
        (a, b) =>
          (relevance[b.r.id ?? ''] ?? 0) - (relevance[a.r.id ?? ''] ?? 0) || b.i - a.i,
      )
      .slice(0, n)
      .map((x) => x.r),
  );
  return runs.filter((r) => keep.has(r));
}

/**
 * Trim the digest until it fits the token budget, least important content first.
 * With relevance from the evidence graph, facts that explain more of the PR keep
 * more text and runs are kept by relevance rather than recency.
 */
function fitBudget(d: TraceDigest, budget: number, relevance?: Relevance): void {
  const rel = (id?: string) => (id && relevance ? (relevance[id] ?? 0) : 0);
  const median = (() => {
    if (!relevance) return 0;
    const v = d.sessions
      .flatMap((s) => s.prompts.map((p) => rel(p.id)))
      .sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)]! : 0;
  })();
  const steps: [string, () => boolean][] = [
    relevance
      ? [
          'plan excerpts shortened to 600 chars (200 for plans from turns with no surviving edits)',
          () =>
            shrink((s) =>
              s.plans.forEach(
                (p) => (p.excerpt = clip(p.excerpt, rel(p.id) > 1 ? 600 : 200)),
              ),
            ),
        ]
      : [
          'plan excerpts shortened to 600 chars',
          () => shrink((s) => s.plans.forEach((p) => (p.excerpt = clip(p.excerpt, 600)))),
        ],
    [
      'prompts that led to no surviving edits dropped',
      () =>
        shrink(
          (s) =>
            (s.prompts = s.prompts.filter(
              (p, i) => p.ledToEdits || p.pushback || i === 0,
            )),
        ),
    ],
    relevance
      ? [
          'prompts shortened to 260 chars (140 for prompts that explain less of the PR)',
          () => {
            const high = (p: DigestSession['prompts'][number]) =>
              !!p.pushback || (rel(p.id) > 0 && rel(p.id) >= median);
            const signal = d.sessions.some((s) => s.prompts.some(high));
            return shrink((s) =>
              s.prompts.forEach(
                (p) => (p.text = clip(p.text, !signal ? 200 : high(p) ? 260 : 140)),
              ),
            );
          },
        ]
      : [
          'prompts shortened to 200 chars',
          () => shrink((s) => s.prompts.forEach((p) => (p.text = clip(p.text, 200)))),
        ],
    [
      'artifact excerpts shortened to 500 chars',
      () => shrink((s) => s.artifacts.forEach((a) => (a.excerpt = clip(a.excerpt, 500)))),
    ],
    ['delegations dropped', () => shrink((s) => (s.delegations = []))],
    [
      'decision excerpts shortened to 150 chars',
      () => shrink((s) => s.decisions.forEach((d) => (d.text = clip(d.text, 150)))),
    ],
    [
      'commit explanations shortened to 300 chars',
      () => {
        d.pr.commits.forEach((c) => {
          if (c.body) c.body = clip(c.body, 300);
        });
        return true;
      },
    ],
    relevance
      ? [
          'runs limited to the 10 most relevant per session (final run of each command, runs no later edit followed)',
          () => shrink((s) => (s.runs = topRuns(s.runs, relevance, 10))),
        ]
      : [
          'runs limited to the last 10 per session',
          () => shrink((s) => (s.runs = s.runs.slice(-10))),
        ],
    [
      'commands limited to 5 per session',
      () => shrink((s) => (s.commands = s.commands.slice(0, 5))),
    ],
    ['file list limited to 40', () => ((d.files = d.files.slice(0, 40)), true)],
    [
      'plan excerpts shortened to 200 chars',
      () => shrink((s) => s.plans.forEach((p) => (p.excerpt = clip(p.excerpt, 200)))),
    ],
  ];
  function shrink(f: (s: DigestSession) => void): boolean {
    d.sessions.forEach(f);
    return true;
  }
  for (const [label, step] of steps) {
    if (estimateTokens(d) <= budget) return;
    step();
    d.truncated.push(label);
  }
}

/**
 * A forked or resumed session repeats its parent's history. Keep each prompt, plan
 * and decision only in the highest-scoring session that has it.
 */
function dedupeAcrossSessions(sessions: DigestSession[]): Map<object, object> {
  const seen = new Map<string, object>();
  /** Each dropped repeat, mapped to the copy that was kept. */
  const alias = new Map<object, object>();
  const fresh = <T extends { t?: string }>(items: T[], text: (x: T) => string): T[] =>
    items.filter((x) => {
      const k = `${x.t ?? ''}|${text(x)}`;
      const kept = seen.get(k);
      if (kept) {
        alias.set(x, kept);
        return false;
      }
      seen.set(k, x);
      return true;
    });
  for (const s of sessions) {
    s.prompts = fresh(s.prompts, (p) => p.text);
    s.delegations = fresh(s.delegations, (p) => p.text);
    s.plans = fresh(s.plans, (p) => p.excerpt);
    s.decisions = fresh(s.decisions, (p) => p.text);
  }
  return alias;
}

/** Give prompts, decisions, plans and runs short ids (S1, D1, P1, R1) the text can cite. */
function numberFacts(sessions: DigestSession[]): void {
  const n = { S: 0, D: 0, P: 0, R: 0 };
  for (const s of sessions) {
    for (const p of s.prompts) p.id = `S${++n.S}`;
    for (const d of s.decisions) d.id = `D${++n.D}`;
    for (const p of s.plans) p.id = `P${++n.P}`;
    for (const r of s.runs) r.id = `R${++n.R}`;
  }
}

export interface BuildOptions {
  budgetTokens?: number;
  /** Preserve complete redacted fact text and runs for expansion. */
  full?: boolean;
  /** Session ids the user chose to include or exclude, overriding the bands. */
  include?: string[];
  exclude?: string[];
  /** Provenance already read for this truth; building twice need not ask git again. */
  interop?: Interop;
  /** Receives each chosen session's ordered trail, for the evidence graph. */
  trails?: SessionTrail[];
}

function buildFullDigest(
  truth: PrTruth,
  matches: SessionMatch[],
  opts: BuildOptions = {},
): TraceDigest {
  const scrub = makeScrubber(truth.roots);
  const salt = truth.remote?.url ?? truth.toplevel;
  const prLines = prLineIndex(truth);
  const prSets = new Map([...prLines.byFile].map(([k, v]) => [k, new Set(v)]));

  const want = (m: SessionMatch) => {
    const h = hashId(salt, m.session.sessionId);
    if (opts.exclude?.some((x) => x === h || x === m.session.sessionId)) return false;
    if (opts.include?.some((x) => x === h || x === m.session.sessionId)) return true;
    return m.band !== 'excluded';
  };
  const chosen = matches.filter(want).sort((a, b) => b.score - a.score);
  const refOf = new Map(
    chosen.map((m) => [m.session.sessionId, hashId(salt, m.session.sessionId)]),
  );
  const trails: SessionTrail[] = [];
  const sessions = chosen.map((m) => {
    const events: TrailEvent[] = [];
    const invocations: Invocation[] = [];
    const s = sessionDigest(
      m,
      refOf.get(m.session.sessionId)!,
      truth,
      prSets,
      scrub,
      events,
      invocations,
    );
    trails.push({ ref: s.ref, events, invocations });
    if (opts.include?.some((x) => x === s.ref || x === m.session.sessionId))
      s.band = 'included';
    return s;
  });
  const alias = dedupeAcrossSessions(sessions);
  numberFacts(sessions);
  if (opts.trails) {
    // A resumed session repeats its parent's prompts; point its events at the kept copy.
    for (const t of trails)
      for (const e of t.events)
        if (e.kind !== 'edit' && alias.has(e.fact))
          (e as { fact: object }).fact = alias.get(e.fact)!;
    opts.trails.push(...trails);
  }
  const full = opts.full || opts.budgetTokens === Number.MAX_SAFE_INTEGER;
  if (!full)
    for (const s of sessions) {
      s.prompts.forEach((p) => (p.text = clip(p.text, 400)));
      s.plans.forEach((p) => (p.excerpt = clip(p.excerpt, 1500)));
      s.decisions.forEach((d) => {
        d.text = clip(d.text, 300);
        d.questions?.forEach((q) => {
          q.question = clip(q.question, 200);
          q.options = q.options.map((o) => clip(o, 80));
          if (q.answer !== undefined) q.answer = clip(q.answer, 400);
        });
      });
      s.runs = s.runs.slice(-25);
    }
  const commitsInSessions = new Set(chosen.flatMap((m) => m.commitsMade));

  const attribution = attribute(truth, prLines, chosen);
  const evidence = attribution.reduce((n, f) => n + f.evidenceLines, 0);
  const unmatched = attribution.reduce((n, f) => n + f.unmatched, 0);
  const pct = (x: number) => (evidence ? Math.round((x / evidence) * 100) : 0);

  const agents = [
    ...new Set(sessions.filter((s) => s.band === 'included').map((s) => s.agent)),
  ];
  const models = [
    ...new Set(sessions.filter((s) => s.band === 'included').flatMap((s) => s.models)),
  ];
  const existingTrailers = [
    ...new Set(
      truth.commits.flatMap((c) =>
        Object.entries(c.trailers)
          .filter(([k]) =>
            /^(co-authored-by|assisted-by|generated-by|ai-used-for)$/i.test(k),
          )
          .flatMap(([k, vs]) => vs.map((v) => `${k}: ${v}`)),
      ),
    ),
  ];
  const suggestedTrailers = sessions
    .filter((s) => s.band === 'included')
    .flatMap((s) =>
      (s.models.length ? s.models : ['unknown-model']).map(
        (m) => `Assisted-by: ${s.agent}:${m}`,
      ),
    );

  const notes: string[] = [];
  if (truth.usedWorkingTree)
    notes.push('No commits ahead of base yet; the digest describes uncommitted changes.');
  if (!sessions.length) notes.push('No agent sessions matched this change.');
  if (truth.dirty && !truth.usedWorkingTree)
    notes.push(
      'The working tree had uncommitted changes: a run in the session may have tested code that is not in the PR.',
    );
  if (sessions.some((s) => s.band === 'ambiguous')) {
    notes.push(
      'Some sessions are ambiguous: confirm with the user before describing them as part of this PR.',
    );
  }
  // Sessions left out that did work in this repo while the commits were made:
  // say so, rather than dropping them without a word.
  for (const m of matches) {
    if (chosen.includes(m) || m.score <= 0) continue;
    const excludedRef = hashId(salt, m.session.sessionId);
    if (opts.exclude?.some((x) => x === excludedRef || x === m.session.sessionId))
      continue;
    const s = m.signals;
    if (!(s.cwdInRepo || s.commandsTouchRepo) || s.timeOverlap <= 0) continue;
    const ref = hashId(salt, m.session.sessionId);
    notes.push(
      `Left out: ${m.session.agent} session "${scrub.text(m.session.title ?? 'untitled')}" (${ref}) worked in this repo while the commits were made, but no edits or commits of this PR were matched to it (score ${m.score}). It is left out; if it clearly belongs, add it with --include ${ref}.`,
    );
  }

  // Commits a cloud agent made, when no session on this machine made them.
  for (const s of cloudSessions(
    truth.commits.filter((c) => !commitsInSessions.has(c.sha)),
  ))
    notes.push(cloudNote(s));

  const digest: TraceDigest = {
    v: 1,
    tool: `tracetoon@${TOOL_VERSION}`,
    generatedAt: new Date().toISOString(),
    repo: { owner: truth.remote?.owner, name: truth.remote?.name },
    pr: {
      number: truth.pr?.number,
      url: truth.pr?.url,
      title: truth.pr ? scrub.text(truth.pr.title) : undefined,
      base: truth.base,
      head: truth.head,
      mergeBase: truth.mergeBase,
      usedWorkingTree: truth.usedWorkingTree,
      ...(truth.dirty ? { dirty: true } : {}),
      commits: truth.commits.map((c) => ({
        sha: full ? c.sha : c.sha.slice(0, 12),
        subject: scrub.text(c.subject),
        ...(c.body
          ? { body: full ? scrub.text(c.body) : clip(scrub.text(c.body), 1200) }
          : {}),
        trailers: c.trailers,
        ...(c.commitTime ? { time: new Date(c.commitTime).toISOString() } : {}),
      })),
    },
    stats: {
      filesChanged: truth.files.length,
      added: truth.files.reduce((n, f) => n + f.added.length, 0),
      removed: truth.files.reduce((n, f) => n + f.removed.length, 0),
      evidenceLines: evidence,
      agentMatchedPct: pct(evidence - unmatched),
      unmatchedPct: pct(unmatched),
      commitsMadeInSessions: commitsInSessions.size,
      commits: truth.commits.length,
      about:
        "Tracetoon's line matching between captured edits and the diff, for the trace section: not who wrote the code. Don't report these numbers as authorship in the description.",
    },
    sessions,
    files: attribution.map((f) => ({
      path: scrub.text(f.path),
      role: fileRole(f.path),
      added: f.added,
      removed: f.removed,
      sessions: [...f.bySession].map(([id, lines]) => ({ ref: refOf.get(id)!, lines })),
      unmatchedLines: f.unmatched,
    })),
    disclosure: {
      agents,
      models,
      suggestedTrailers: [...new Set(suggestedTrailers)],
      existingTrailers,
    },
    interop: opts.interop ?? detectInterop(truth),
    privacy: {
      redactions: 0,
      droppedForeignRecords: chosen.reduce((n, m) => n + m.droppedForeign, 0),
      sessionIdsHashed: true,
    },
    linkedPrs: [
      ...new Set(
        chosen
          .filter((m) => m.band !== 'excluded')
          .flatMap((m) => m.kept)
          .flatMap((r) =>
            r.kind === 'link' && r.prNumber && r.prNumber !== truth.pr?.number
              ? [r.prNumber]
              : [],
          ),
      ),
    ],
    notes,
    truncated: [],
  };
  if (!full) fitBudget(digest, opts.budgetTokens ?? 12000);
  digest.privacy.redactions = scrub.redactions;
  return digest;
}

/** Project from independent redacted data; budgeting must never trim expansion evidence. */
export function compactDigest(
  full: TraceDigest,
  budgetTokens = 12000,
  relevance?: Relevance,
): TraceDigest {
  const digest = structuredClone(full);
  for (const s of digest.sessions) {
    s.prompts.forEach((p) => (p.text = clip(p.text, 400)));
    s.plans.forEach((p) => (p.excerpt = clip(p.excerpt, 1500)));
    s.decisions.forEach((d) => {
      d.text = clip(d.text, 300);
      d.questions?.forEach((q) => {
        q.question = clip(q.question, 200);
        q.options = q.options.map((o) => clip(o, 80));
        if (q.answer !== undefined) q.answer = clip(q.answer, 400);
      });
    });
    s.runs = relevance ? topRuns(s.runs, relevance, 25) : s.runs.slice(-25);
  }
  digest.pr.commits = digest.pr.commits.map((c) => ({
    ...c,
    sha: c.sha.slice(0, 12),
    ...(c.body ? { body: clip(c.body, 1200) } : {}),
  }));
  fitBudget(digest, budgetTokens, relevance);
  return digest;
}

export function buildDigestPair(
  truth: PrTruth,
  matches: SessionMatch[],
  opts: BuildOptions & {
    /**
     * Called with the full digest and session trails before projection: builds the
     * evidence graph, annotates the full digest and returns fact relevance.
     */
    enrich?: (full: TraceDigest, trails: SessionTrail[]) => Relevance | undefined;
  } = {},
) {
  const start = performance.now();
  const trails: SessionTrail[] = [];
  const full = buildFullDigest(truth, matches, { ...opts, full: true, trails });
  const relevance = opts.enrich?.(full, trails);
  const extractionMs = performance.now() - start;
  const projectionStart = performance.now();
  const digest = compactDigest(full, opts.budgetTokens, relevance);
  return {
    digest,
    full,
    extractionMs,
    projectionMs: performance.now() - projectionStart,
  };
}

export function buildDigest(
  truth: PrTruth,
  matches: SessionMatch[],
  opts: BuildOptions = {},
): TraceDigest {
  const full = buildFullDigest(truth, matches, { ...opts, full: true });
  return opts.full || opts.budgetTokens === Number.MAX_SAFE_INTEGER
    ? full
    : compactDigest(full, opts.budgetTokens);
}
