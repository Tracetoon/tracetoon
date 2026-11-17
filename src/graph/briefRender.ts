/**
 * What `render` does with the evidence brief:
 *
 * - writes the Validation section itself from the brief's validation rows, at
 *   the `<!-- tracetoon:validation -->` marker, so no writer restates (and
 *   rewords) run results;
 * - removes the writer's ref tags (`[CH1, S1]`) and reports sentences with no
 *   tag or an unknown ref, tagged sentences naming code their refs don't
 *   mention, and run or test claims made outside that section.
 *
 * The checks are advisory; the text is deterministic.
 */
import type { Section } from './queries.ts';
import { existingSymbols, housekeepingOverclaim } from './doNotSay.ts';
import { wordsOf } from './codeEvidence.ts';
import { COULD_NOT_RUN, ORPHAN_COMMAND, TIMED_OUT } from '../trace/types.ts';

export const VALIDATION_MARKER = '<!-- tracetoon:validation -->';

export interface BriefParts {
  sections: Section[];
  unchecked: string[];
  /** Symbols (or files) whose changed lines branch or fall back. */
  branchy?: string[];
  /** Changed source functions and the stemmed words the brief ties to each (`functionProfiles`). */
  owners?: { name: string; file: string; nameWords: string[]; words: string[] }[];
  /** A `tracetoon check` receipt passed on the submitted content. */
  freshPass?: boolean;
  /**
   * Toolchain versions the repo pins that differ from the ones that ran here
   * (`toolchainMismatch`): a fresh failure may reflect this environment.
   */
  toolchain?: string[];
}

export interface BriefApplied {
  text: string;
  /** The Validation section was written at the marker. */
  validation: boolean;
  /** Ref tags found and removed. */
  tags: number;
  unknownRefs: string[];
  /** Sentences that state something but carry no ref tag. */
  untagged: string[];
  /** Run, test or check claims outside the generated Validation section. */
  validationClaims: string[];
  /** Tagged sentences that name code (`fn`, a type, a file) no cited row mentions. */
  unbackedNames: { sentence: string; names: string[] }[];
  /** Brief rows no tag cites: change units, commit sentences, tests, housekeeping, the goal. */
  uncovered: string[];
  /** Sentences that overstate what the brief backs, with what to fix. */
  flags: { sentence: string; problem: string; severity: 'fix' | 'check' }[];
}

const rowsOf = (b: BriefParts, title: string) =>
  b.sections.find((s) => s.title === title)?.rows ?? [];

/** A command as run, without output redirections (files, /dev/null, redacted paths). */
export function shownCommand(cmd: unknown): string {
  return (
    String(cmd ?? '')
      // Repository paths as typed from its root: no local placeholder.
      .replace(/<repo>\//g, '')
      .replace(/(^|[=\s:])<repo>(?=$|[\s:;|&])/g, '$1.')
      .replace(/\s+(\d?>>?|&>)\s*(&\d|<[^>\s]+>|"[^"]*"|'[^']*'|[^\s;|&]+)/g, '')
      .replace(/\s+([;|&]{1,2})\s*/g, ' $1 ')
      .trim()
  );
}

const plain = (s: unknown) =>
  String(s ?? '')
    .replace(/\*\*|__|`/g, '')
    .trim()
    .replace(/[.!]+$/, '');

const list = (xs: unknown) => {
  const a = (Array.isArray(xs) ? xs : []).map(String).filter(Boolean);
  const more = /^\+(\d+) more$/.exec(a.at(-1) ?? '');
  return more ? `${a.slice(0, -1).join(', ')} and ${more[1]} more` : a.join(', ');
};

/**
 * A session-log validation row render may state: a recorded result with
 * result lines, from one command. Exported for replays.
 */
export function logRunStatable(r: Record<string, unknown>): boolean {
  if (r.outcome !== 'passed' && r.outcome !== 'failed') return false;
  if (!plain(r.result)) return false;
  // The digest's word on whether the log shows it (see digest/build.ts `statable`).
  if (r.statable === false) return false;
  // An exit status is not a result line a reader can find.
  if (/^exit \d+(, no output)?$/.test(plain(r.result))) return false;
  return !shownCommand(r.cmd).includes(' ; ');
}

/** Files edited after a run, by name: at most four, else a count with the first two. */
function editedList(xs: unknown): string {
  const all = (Array.isArray(xs) ? xs : []).map(String).filter(Boolean);
  const more = /^\+(\d+) more$/.exec(all.at(-1) ?? '');
  const names = more ? all.slice(0, -1) : all;
  const total = names.length + (more ? Number(more[1]) : 0);
  if (total <= 4) return list(names);
  return `${total} files, among them ${names.slice(0, 2).join(' and ')}`;
}

/**
 * Absolute local paths in quoted output (`Report: /src/test-results/x.json`):
 * repo-relative when a known repo path ends the path, else `<local path>`.
 * URLs and repo-relative paths are left alone.
 */
export function redactLocalPaths(text: string, repoPaths: string[] = []): string {
  const tops = new Set(repoPaths.map((p) => p.split('/')[0]!).filter(Boolean));
  return text.replace(/(?<![\w.:/<>~-])\/(?:[\w.@+-]+\/)+[\w.@+-]*/g, (path) => {
    const parts = path.slice(1).split('/');
    for (let i = 1; i < parts.length; i++) {
      const rest = parts.slice(i).join('/');
      if (
        rest &&
        (repoPaths.includes(rest) || (tops.has(parts[i]!) && i < parts.length - 1))
      )
        return rest;
    }
    return '<local path>';
  });
}

/** Repo paths the brief names: changed files and test files. */
const repoPathsOf = (b: BriefParts) =>
  [
    ...new Set([
      ...rowsOf(b, 'changes').flatMap((r) =>
        (Array.isArray(r.where) ? r.where : []).map((w) =>
          String(w).replace(/\s*\(.*$/, ''),
        ),
      ),
      ...rowsOf(b, 'tests').map((r) => String(r.file ?? '')),
    ]),
  ].filter(Boolean);

/**
 * A check's result lines as a reader sees them: whitespace collapsed, quoted
 * source lines (`103 |   expect(…)`) dropped, local paths redacted.
 */
function resultText(result: unknown, repoPaths: string[]): string {
  return redactLocalPaths(
    plain(result)
      .split(/\s*;\s*/)
      .map((x) => x.replace(/\s+/g, ' ').trim())
      .filter((x) => x && !/^\d+\s*\|/.test(x) && !/\bexpect\(/.test(x))
      .join(', '),
    repoPaths,
  );
}

/** A brief ref in prose: `CH1`, `R42`, `L3`. */
const BRIEF_REF = /\b(?:CH|HK|PR|HS|[STLRDPHBV])\d+\b/;

/**
 * An open `limits` row as a sentence for readers: no brief refs or run ids,
 * "the session logs" for what was recorded, a commit-message-only result
 * attributed to that message. Undefined when nothing readable is left.
 */
export function limitSentence(
  limit: unknown,
  repoPaths: string[] = [],
): string | undefined {
  let t = String(limit ?? '').trim();
  if (!t) return undefined;
  const claim = /^"(.+)" comes only from commit ([0-9a-f]{7,40})'s message\b/.exec(t);
  if (claim) t = `Only commit ${claim[2]}'s message reports "${claim[1]}".`;
  t = t
    .replace(/the logs Tracetoon read/g, 'the session logs')
    .replace(/\bTracetoon can't tell whether\b/g, "the session logs don't show whether")
    .replace(/^Tracetoon recognized no\b/, 'The session logs show no')
    .replace(/\bTracetoon\b/g, 'the session logs')
    // Run and receipt ids: "(R42)", "(R63, test)", "(R4, R6 … R17)".
    .replace(/\s*\((?:[RV]\d+(?:\s*(?:,|…|and)\s*)?)+\)/g, '')
    .replace(/\(([RV]\d+),\s*/g, '(');
  // A clause still naming a brief ref says nothing a reader can follow.
  const clauses = t
    .replace(/[.]\s*$/, '')
    .split(/;\s+/)
    .filter((c) => !BRIEF_REF.test(c.replace(/`[^`]*`/g, '')));
  if (!clauses.length) return undefined;
  t = clauses.join('; ');
  t = redactLocalPaths(t, repoPaths).trim();
  if (!t) return undefined;
  // A sentence starting with a word, not a path or file name, starts upper-case.
  if (/^[a-z][a-z'-]*(?=[\s,;:])/.test(t)) t = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Open `limits` rows render writes under the Validation section, as plain
 * sentences: every open row except a "no pass after the last edit" point a
 * passing fresh check already answers.
 */
export function openPointLines(b: BriefParts): string[] {
  const receiptPassed =
    !!b.freshPass ||
    rowsOf(b, 'validation').some(
      (r) => /^V\d/.test(String(r.check ?? '')) && r.outcome === 'passed',
    );
  const paths = repoPathsOf(b);
  const out: string[] = [];
  for (const r of rowsOf(b, 'limits')) {
    if (r.kind !== 'open') continue;
    if (receiptPassed && PASS_LIMIT.test(String(r.limit ?? ''))) continue;
    const line = limitSentence(r.limit, paths);
    if (line && !out.includes(line)) out.push(line);
  }
  return out;
}

/** Most a reader needs: the test runs first, then the other checks. */
const KIND_ORDER = ['test', 'typecheck', 'lint', 'build', 'eval'];
const MAX_LINES = 3;
/** Kinds of a recognized check run (a process row's `kind`, a validation row's). */
const CHECK_KINDS = new Set(['test', 'typecheck', 'lint', 'build']);

/**
 * The Validation section, from the brief's validation rows only: at most five
 * lines, test runs first. Rows with a withheld command, and non-test checks
 * whose result Tracetoon couldn't read, say nothing a reviewer can use and are
 * left out. The "may predate the final code" caveat is said once, at the end.
 */
export function validationSection(b: BriefParts): string {
  // Only recorded results, at most three lines: the whole suite and the latest
  // focused test run, then a typecheck or lint. Commit-message results, runs with
  // no captured result and files with no passing run after their last edit are
  // open points the prose covers (limits rows), so they aren't repeated here.
  // Every check Tracetoon ran on the submitted content (V receipts) is shown,
  // whatever its kind (a dropped `bun run bundle` receipt cost a dev19 pair);
  // session-log runs fill the rest, one per kind with no receipt, up to three
  // lines in all. An earlier failure of a shown kind gets one clause; the
  // whole history is a process fact, not repeated here.
  const shown: { kind: string; line: string; when: string; current: boolean }[] = [];
  const paths = repoPathsOf(b);
  const perKind = new Map<string, number>();
  // A receipt that hit the time limit is listed too: incomplete, never failed.
  const timedOut = (r: Record<string, unknown>) => plain(r.result).startsWith(TIMED_OUT);
  const rows = rowsOf(b, 'validation').filter(
    (r) =>
      r.outcome === 'passed' ||
      r.outcome === 'failed' ||
      (/^V\d/.test(String(r.check ?? '')) && timedOut(r)),
  );
  const receipts = rows.filter((r) => /^V\d/.test(String(r.check ?? '')));
  const logRuns = rows.filter((r) => !/^V\d/.test(String(r.check ?? '')));
  // Every receipt is listed, each command once: a later receipt for the same
  // command (a rerun under another check name) replaces the earlier one.
  const latest = new Map<string, (typeof receipts)[number]>();
  for (const r of receipts) {
    const cmd = shownCommand(r.cmd);
    if (!cmd || /‹withheld›|<withheld>/.test(cmd)) continue;
    latest.delete(cmd);
    latest.set(cmd, r);
  }
  const changed = new Set(
    rowsOf(b, 'changes').flatMap((r) =>
      ((r.where as string[]) ?? []).map((w) => String(w).replace(/\s*\(.*$/, '')),
    ),
  );
  const passing: { cmd: string; result: string }[] = [];
  for (const [cmd, r] of latest) {
    if (r.outcome === 'passed' && !plain(r.result).startsWith(COULD_NOT_RUN)) {
      const result = resultText(r.result, paths);
      passing.push({ cmd, result });
      continue;
    }
    // A check that could not start here (no tool, dependency or network) did
    // not fail on the submitted content: it says why, and nothing more.
    if (timedOut(r)) {
      shown.push({
        kind: String(r.kind),
        line: `- \`${cmd}\`: ${plain(r.result).split(/\s*;\s*/)[0]}; it gave no pass/fail result on the code.`,
        when: 'fresh',
        current: true,
      });
      continue;
    }
    const unrun = plain(r.result).startsWith(COULD_NOT_RUN);
    if (unrun) {
      const why = plain(r.result).slice(COULD_NOT_RUN.length).trim();
      // A pinned toolchain other than this one: said as such, no counts.
      const pinned = /^as pinned here\b/.test(why);
      shown.push({
        kind: String(r.kind),
        line: pinned
          ? `- \`${cmd}\`: could not run ${why}; it got no pass/fail result on the code.`
          : `- \`${cmd}\`: could not run in this environment${why ? ` (${why})` : ''}; it got no result on the code.`,
        when: 'fresh',
        current: true,
      });
      continue;
    }
    // A failure: the failing test files its output names, and whether this PR
    // changed them; a pinned toolchain other than the one that ran.
    const failing =
      r.outcome === 'failed'
        ? [
            ...new Set(
              (plain(r.result).match(TEST_FILE) ?? []).map((f) => f.replace(/^\.\//, '')),
            ),
          ].slice(0, 3)
        : [];
    const inPr = (f: string) =>
      [...changed].some((c) => c === f || c.endsWith(`/${f}`) || f.endsWith(`/${c}`));
    const notes = [
      ...(failing.length
        ? [
            `Failing test file${failing.length === 1 ? '' : 's'}: ${failing
              .map(
                (f) =>
                  `\`${f}\` (${inPr(f) ? 'changed in this PR' : 'not changed in this PR'})`,
              )
              .join(', ')}.`,
          ]
        : []),
      ...(r.outcome === 'failed' && b.toolchain?.length
        ? [
            `The repo pins ${b.toolchain.join(', ')}; the failure may reflect this environment rather than the change.`,
          ]
        : []),
    ];
    shown.push({
      kind: String(r.kind),
      line: `- \`${cmd}\`: ${String(r.outcome)}${
        resultText(r.result, paths) ? ` (${resultText(r.result, paths)})` : ''
      }, run on the submitted content.${notes.length ? ` ${notes.join(' ')}` : ''}`,
      when: 'fresh',
      current: true,
    });
  }
  // Every pass on one line, each command with its counts beside it; only
  // failures, timeouts and environment notes get lines of their own.
  if (passing.length)
    shown.unshift({
      kind: 'receipts',
      line:
        passing.length === 1
          ? `- \`${passing[0]!.cmd}\`: passed${passing[0]!.result ? ` (${passing[0]!.result})` : ''}, run on the submitted content.`
          : `- Checks passed on the submitted content: ${passing
              .map((p) => `\`${p.cmd}\`${p.result ? ` (${p.result})` : ''}`)
              .join(', ')}.`,
      when: 'fresh',
      current: true,
    });
  // A receipt that could not run here leaves its kind to the session logs.
  // A failed receipt keeps the kind's last session run beside it: the pass
  // the session saw is evidence too, and the failure may be this environment.
  const receiptKinds = new Set(
    receipts
      .filter((r) => r.outcome === 'passed' && !plain(r.result).startsWith(COULD_NOT_RUN))
      .map((r) => String(r.kind)),
  );
  for (const r of logRuns) {
    if (shown.length >= MAX_LINES) break;
    const kind = String(r.kind);
    if (!['test', 'typecheck', 'lint', 'build'].includes(kind)) continue;
    if (receiptKinds.has(kind)) continue;
    const cmd = shownCommand(r.cmd);
    if (!cmd || /‹withheld›|<withheld>/.test(cmd)) continue;
    // Only a result a reader can find in the session: result lines of its own,
    // from one command (not several sharing an output). A pass known only from
    // an exit status, or a merged output, is dropped rather than hedged.
    if (!logRunStatable(r)) continue;
    // A receipt for the same command already says more.
    if (
      shown.some(
        (x) =>
          x.current &&
          x.line.startsWith(`- \`${cmd}\`:`) &&
          !x.line.startsWith(`- \`${cmd}\`: could not run in this environment`) &&
          !x.line.startsWith(`- \`${cmd}\`: failed`),
      )
    )
      continue;
    const n = perKind.get(kind) ?? 0;
    if (n >= 1) continue;
    perKind.set(kind, n + 1);
    // A run from the session logs is history: its own result lines, which the
    // session shows next to the command, and the files edited after it by name.
    const edited = editedList(r.editedAfter);
    // An earlier failure of the kind, in one clause (the brief's `earlier`
    // column: "`cmd` failed (4 pass, 1 fail)"), when this run passed.
    const earlier =
      r.outcome === 'passed' && typeof r.earlier === 'string' && r.earlier.trim()
        ? r.earlier
            .trim()
            .replace(/[.;]+$/, '')
            .replace(/;\s*/g, ', ')
        : '';
    // A fallback run (no passing receipt; see runHistory `historyFallback`):
    // the run of the kind that came after it, by command and outcome.
    const followed = typeof r.followedBy === 'string' ? r.followedBy.trim() : '';
    shown.push({
      kind,
      // A run with later edits says so even when they aren't PR files, as
      // the claim check (digest/claims.ts) requires of a stale run.
      line: `- ${cmd === ORPHAN_COMMAND ? "A test run whose command the log doesn't show" : `\`${cmd}\``}: ${String(r.outcome)} (${resultText(r.result, paths)}) in the session logs${edited ? `, before later edits to ${edited}` : String(r.when ?? '').startsWith('before later edits') ? ', before later edits' : ''}.${earlier ? ` An earlier run of ${earlier}.` : ''}${followed ? ` Followed by ${followed}.` : ''}`,
      when: String(r.when ?? ''),
      current: false,
    });
  }
  const order = (k: string) =>
    KIND_ORDER.indexOf(k) < 0 ? KIND_ORDER.length : KIND_ORDER.indexOf(k);
  const lines = [
    ...shown.filter((x) => x.current),
    ...shown.filter((x) => !x.current).sort((x, y) => order(x.kind) - order(y.kind)),
  ].map((x) => x.line);
  // Nothing Tracetoon recognized is not nothing run: say what it could read,
  // and name the commands after the last edit that it does not classify
  // (when no shown run is that recent).
  const others = rowsOf(b, 'otherRuns')
    .map((r) => shownCommand(r.cmd))
    .filter((c) => c && !/‹withheld›|<withheld>/.test(c))
    .slice(0, 3);
  const stale = shown.every((x) => !x.current && x.when.startsWith('before later edits'));
  // An empty-state line only when no check ran at all: with recognized runs
  // whose results a reader can't check here, "found no result" was read as
  // "no checks ran" (the process rows list them).
  const ranChecks =
    rowsOf(b, 'validation').some((r) => CHECK_KINDS.has(String(r.kind))) ||
    rowsOf(b, 'process').some(
      (r) => CHECK_KINDS.has(String(r.kind)) || String(r.kind) === 'checks',
    );
  // No empty-state line: the brief reads only the turns attributed to this PR,
  // so "no check appears" was restated as a session-wide fact that the full
  // logs contradicted (checks run earlier in a shared session). Silence lets
  // the writer leave validation out rather than claim there was none.
  void ranChecks;
  // Checks ran but none can be stated: no line. A "can't read a result" line
  // was restated by writers as "no checks ran" (round 2, 24 judged errors).
  if (others.length && stale)
    lines.push(
      `- After the last captured edit the session also ran ${others.map((c) => `\`${c}\``).join(', ')}, which are not classified as checks.`,
    );
  // Said once, and only when a shown run is dated by the logs' last edit rather
  // than checked against the submitted content.
  const predates = shown.some((x) => x.when.startsWith('after the last edit'));
  const fresh = shown.some((x) => /submitted content|fresh/i.test(x.when));
  if (predates && !fresh)
    lines.push("- The session logs don't show whether these runs saw the final commit.");
  // Every open point the brief lists, as plain sentences: the writer doesn't
  // restate them, and a reader finds the checks and their limits together.
  const open = openPointLines(b).filter(
    (o) => !lines.some((l) => l.includes(o.replace(/[.]$/, ''))),
  );
  if (!lines.length && !open.length) return '';
  const fromReceipts = shown.some((x) => x.current);
  const fromLogs = shown.some((x) => !x.current);
  return [
    '## Validation',
    '',
    ...(lines.length
      ? [
          `<sub>From ${
            fromReceipts && fromLogs
              ? 'runs on the submitted content and, on separate lines, the checks recorded in the session logs while the change was made'
              : fromReceipts
                ? 'runs on the submitted content'
                : 'the checks recorded in the session logs while the change was made'
          }.</sub>`,
          '',
          ...lines,
        ]
      : []),
    ...(open.length
      ? [...(lines.length ? [''] : []), 'Open points:', '', ...open.map((o) => `- ${o}`)]
      : []),
  ].join('\n');
}

/** Test file paths in a check's output. */
const TEST_FILE =
  /(?:\.\/)?[\w./-]*?(?:[\w-]+\.(?:test|spec)\.[cm]?[jt]sx?|test_[\w]+\.py|[\w]+_test\.(?:py|go)|[\w]+Test\.(?:java|kt))\b/g;

/** Every ref a writer may cite. */
export function briefRefs(b: BriefParts): Set<string> {
  const out = new Set<string>();
  for (const s of b.sections)
    for (const r of s.rows)
      for (const k of ['change', 'ref', 'check'])
        if (typeof r[k] === 'string' && r[k]) out.add(r[k] as string);
  // A commit's rows (`<sha>`, `<sha>#n`) also answer to `commit:<sha>` and `commit:<sha>#n`.
  for (const ref of [...out]) {
    const m = /^(?:commit:)?([0-9a-f]{7,40})(#\d+)?$/.exec(ref);
    if (m) {
      out.add(`commit:${m[1]}${m[2] ?? ''}`);
      out.add(`${m[1]}${m[2] ?? ''}`);
    }
  }
  return out;
}

/** The text of every row each ref names, for checking what a tagged sentence cites. */
function refTexts(b: BriefParts): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  for (const sec of b.sections)
    for (const r of sec.rows)
      for (const k of ['change', 'ref', 'check'])
        if (typeof r[k] === 'string' && r[k])
          out.push({
            key: (r[k] as string).replace(/^commit:/, ''),
            text: JSON.stringify(r),
          });
  return out;
}

const citedText = (rows: { key: string; text: string }[], refs: string[]) =>
  refs
    .map((ref) => ref.replace(/^commit:/, ''))
    .flatMap((ref) =>
      rows.filter((r) =>
        /^[0-9a-f]{7,40}(#\d+)?$/.test(ref)
          ? r.key.startsWith(ref.split('#')[0]!) || ref.startsWith(r.key.split('#')[0]!)
          : r.key === ref,
      ),
    )
    .map((r) => r.text)
    .join('\n');

/**
 * Code a sentence names: backticked names shaped like code (`a_b`, `a.b`,
 * `src/x.ts`, `fn()`, `camelCase`, `PascalCase`) and bare lowerCamel words.
 * Plain words and product names (`pushd`, OpenAI) are not checked.
 */
function codeNames(sentence: string): string[] {
  const names = new Set<string>();
  for (const m of sentence.matchAll(/`([^`\s]+)`/g)) {
    const raw = m[1]!;
    const n = raw.replace(/\(\)$/, '');
    // Code, not URLs or versions (`file:///`, `v1.0.0-rc.10`).
    if (!/^[A-Za-z_.][\w.$/-]*$/.test(n) || /^v?\d|:\/\/|^rc\.\d/i.test(n)) continue;
    if (raw.endsWith('()') || /[_./]/.test(n) || /[a-z][A-Z]/.test(n)) names.add(n);
  }
  for (const m of sentence.replace(/`[^`]*`/g, ' ').matchAll(/\b([a-z]+[A-Z]\w*)\b/g))
    names.add(m[1]!);
  return [...names];
}

/** Known, or a 7+ character prefix of a known commit sha (`421ce02` for `commit:421ce024cc68`). */
function knownRef(known: Set<string>, ref: string): boolean {
  if (known.has(ref)) return true;
  const m = /^(?:commit:)?([0-9a-f]{7,40})(#\d+)?$/.exec(ref);
  if (!m) return false;
  for (const k of known) {
    const n = /^(?:commit:)?([0-9a-f]{7,40})(#\d+)?$/.exec(k);
    if (n && n[1]!.startsWith(m[1]!) && (n[2] ?? '') === (m[2] ?? '')) return true;
  }
  return false;
}

/**
 * A ref a writer may put in a tag: a brief ref (`CH1`, `S2`, `L3`), a commit
 * (`commit:<sha>#n`), a patch range (`diff:660-684`) or a session (`h:<hash>`).
 * Patch ranges and sessions are stripped like the others but never unknown.
 */
const REF = String.raw`(?:[A-Z]{1,3}\d+|(?:commit:)?[0-9a-f]{7,40}(?:#\d+)?|diff:\d+(?:-\d+)?|h:[0-9a-f]{6,40})`;
const TAG = new RegExp(
  String.raw`[ \t]?\[(${REF}(?:\s*[,;]\s*${REF}|\s+${REF})*)\s*\](?!\()`,
  'g',
);
/** Splits a tag's refs at commas, semicolons or spaces. */
const tagRefs = (inner: string) => inner.split(/\s*[,;]\s*|\s+/).filter(Boolean);
/** Patch ranges and session ids: citable without a brief row. */
const LOOSE_REF = /^(?:diff:\d+(?:-\d+)?|h:[0-9a-f]{6,40})$/;

/** Run, test or check results stated in prose. */
const VALIDATION_CLAIM =
  /\b(\d+\s*(pass|passed|fail|failed|failures?)\b|tests? (pass|passed|fail|failed|ran|run)\b|(passed|passes|passing|failed|failing)\b|untested|not tested|exercised|typecheck(s|ed)?\b|no recorded run)/i;

/**
 * A sentence saying something was not tested, run or recorded ("not tested on
 * hardware", "no live run was recorded", "untested"). Tracetoon reads only the
 * turns attributed to this PR, so such an absence needs a `limits` row.
 */
const ABSENCE =
  /\b(?:untested|not (?:been |yet )?(?:tested|run|re-?run|recorded|verified|exercised|executed)|never (?:been )?(?:tested|run|executed)|(?:was|were|is|are|has|have)(?:n't| not)(?: been)? (?:tested|run|recorded|verified|exercised)|no\s+(?:[\w-]+\s+){0,5}(?:was|were|has been|have been|is|are)\s+(?:run|recorded|executed|tested|performed)|without (?:running|testing|a (?:test|live) run))\b/i;

/** Words that carry a sentence's subject (for "restates a limits row"). */
const COMMON = new Set(
  'the and for with that this from into when then than only not are was were has have had its also each but out off our you yet any all can was been being which what there here they them their these those such some more most other run runs ran test tests tested check checks checked recorded record session sessions tracetoon evidence shows show logs log'.split(
    ' ',
  ),
);
const contentWords = (s: string) => [
  ...new Set(
    (s.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []).filter((w) => !COMMON.has(w)),
  ),
];

/** Lines of prose: skips headings, code, HTML, tables and the generated section. */
function proseUnits(text: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || !line || /^(#|<|\||-{3,}|\*{3,})/.test(line)) continue;
    const body = line.replace(/^([-*+]|\d+[.)])\s+/, '');
    for (const s of body.split(/(?<=[.!?])\s+(?=[A-Z`"(])/))
      if (s.trim()) out.push(s.trim());
  }
  return out;
}

/**
 * Removes ref tags, writes the Validation section at the marker, and reports
 * what the evidence brief doesn't back. Without a brief the marker and the
 * tags are dropped.
 */
/** An open point about no pass, or only a historical pass, on the final content. */
const PASS_LIMIT =
  /\bno passing (?:check |test, build, lint or typecheck )?run\b|\bnot re-run on the final content\b|\bno pass(?:ing run)? (?:recorded )?after the last\b/i;

export function applyBrief(body: string, b: BriefParts | undefined): BriefApplied {
  if (!b)
    return {
      // Ref tags never reach readers, even when no brief could be loaded.
      text: body
        .replace(`${VALIDATION_MARKER}\n`, '')
        .replace(VALIDATION_MARKER, '')
        .replace(TAG, ''),
      validation: false,
      tags: 0,
      unknownRefs: [],
      untagged: [],
      validationClaims: [],
      unbackedNames: [],
      uncovered: [],
      flags: [],
    };
  const known = briefRefs(b);
  const flags: BriefApplied['flags'] = [];
  const cites = new Set<string>();
  const commitRows = rowsOf(b, 'commitMessages');
  const commitRow = (ref: string) => {
    const r = ref.replace(/^commit:/, '');
    return commitRows.find((x) => {
      const k = String(x.ref).replace(/^commit:/, '');
      const [a, an] = k.split('#');
      const [c, cn] = r.split('#');
      return (an ?? '') === (cn ?? '') && (a!.startsWith(c!) || c!.startsWith(a!));
    });
  };
  const changeRows = rowsOf(b, 'changes');
  const symbolsOf = (where: unknown) =>
    (Array.isArray(where) ? where : []).flatMap((w) => {
      const m = /\(([^)]*)\)/.exec(String(w));
      return m ? m[1]!.split(/,\s*/) : [];
    });
  // Files and symbols the brief places somewhere: naming one of these in the
  // wrong place is a misattribution; an unlisted name (a JSON field) is not.
  const placed = [
    ...changeRows.flatMap((r) => (Array.isArray(r.where) ? r.where : [])),
    ...commitRows.flatMap((r) => (Array.isArray(r.implementedBy) ? r.implementedBy : [])),
  ].map(String);
  const placedNames = new Set(
    placed.flatMap((w) => {
      const file = w.replace(/\s*\(.*$/, '');
      return [file, file.split('/').pop()!, ...symbolsOf([w])];
    }),
  );
  // The same names the brief's doNotSay rows list as existing before this PR.
  const existing = new Set(existingSymbols(b.sections));
  // Names with conditional paths: from the brief's branch list, and any limit naming them.
  const limitText = [
    ...(b.branchy ?? []),
    ...rowsOf(b, 'limits').map((r) => String(r.limit ?? '')),
  ].join('\n');
  const unknown = new Set<string>();
  let tags = 0;
  const untagged: string[] = [];
  const validationClaims: string[] = [];
  const unbackedNames: BriefApplied['unbackedNames'] = [];
  const rows = refTexts(b);
  for (const unit of proseUnits(body)) {
    const found = [...unit.matchAll(TAG)];
    const clean = unit.replace(TAG, '').trim();
    if (VALIDATION_CLAIM.test(clean)) validationClaims.push(clean);
    if (!found.length) {
      // Short labels and lead-ins ("Changes:", "Start here") state nothing.
      if (clean.split(/\s+/).length >= 5 && !clean.endsWith(':')) untagged.push(clean);
      continue;
    }
    const refs = found.flatMap((m) => tagRefs(m[1]!));
    for (const ref of refs) {
      tags++;
      if (!LOOSE_REF.test(ref) && !knownRef(known, ref)) unknown.add(ref);
      cites.add(ref.replace(/^commit:/, ''));
    }
    // Where a cited commit sentence's code is known (implementedBy), names
    // must come from there; otherwise from any cited row. Citing a broad
    // change unit doesn't license pinning a commit's behavior on its files.
    const located = refs
      .map(commitRow)
      .filter(
        (r) =>
          r && Array.isArray(r.implementedBy) && (r.implementedBy as string[]).length,
      );
    // Only a located commit sentence can show a name is in the wrong place;
    // a name merely missing from the brief (its rows are capped) proves nothing.
    if (located.length) {
      const cited = located
        .map((r) => (r!.implementedBy as string[]).join('\n'))
        .join('\n');
      const names = codeNames(clean).filter(
        (n) =>
          placedNames.has(n.split('/').pop()!) &&
          !cited.includes(n) &&
          !cited.includes(n.split('/').pop()!),
      );
      if (names.length) unbackedNames.push({ sentence: clean, names });
    }
    const named = codeNames(clean);
    // "New" for code that already existed.
    {
      const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const old = named.filter(
        (n) =>
          existing.has(n) &&
          (new RegExp(
            `\\b(new|adds?|added|adding|introduc\\w*|creates?|created)\\s+(?:an?\\s+|the\\s+)?[^.,;:]{0,30}?\`?${esc(n)}\\b`,
            'i',
          ).test(clean) ||
            new RegExp(`\`?${esc(n)}\`?\\s+(?:is|are)\\s+(?:a\\s+)?new\\b`, 'i').test(
              clean,
            )),
      );
      if (old.length)
        flags.push({
          sentence: clean,
          severity: 'fix',
          problem: `${old.map((n) => `\`${n}\``).join(', ')} already existed (not in newSymbols): say it changed, not that it is new.`,
        });
    }
    // Universal words about code that branches.
    const universal = /\b(only|always|all|every|no longer|never)\b/i.exec(clean)?.[1];
    if (universal) {
      const branchy = named.filter((n) => limitText.includes(n));
      if (branchy.length)
        flags.push({
          sentence: clean,
          severity: 'check',
          problem: `"${universal}": ${branchy.join(', ')} has conditional paths; read them in the patch and keep "${universal}" if every path in the patch does this; otherwise qualify the sentence. Don't drop the behavior.`,
        });
      else if (/^(?:only|always|every|no longer|never)$/i.test(universal)) {
        // A cited change or behavior row whose lines carry a condition.
        const guarded = refs
          .map((r) => r.replace(/^commit:/, ''))
          .flatMap((r) => [
            ...changeRows.filter((x) => x.change === r),
            ...rowsOf(b, 'behaviors').filter((x) => x.ref === r),
          ])
          .some((x) => CONDITION.test(`${list(x.behavior)} ${String(x.text ?? '')}`));
        if (guarded)
          flags.push({
            sentence: clean,
            severity: 'check',
            problem: `"${universal}": the cited rows' lines carry a condition (if/when/unless/fallback); keep "${universal}" only if every path does this, otherwise state the condition.`,
          });
      }
    }
    // "Previously …" with no cited row that shows the old code.
    if (/^previously\b/i.test(clean)) {
      const oldShown = refs
        .map((r) => r.replace(/^commit:/, ''))
        .some(
          (r) =>
            /^[0-9a-f]{7,40}(#\d+)?$/.test(r) ||
            /^[SP]\d+$/.test(r) ||
            changeRows.some(
              (x) =>
                x.change === r &&
                ((typeof x.was === 'string' ? x.was.trim() : list(x.was)) ||
                  (x.before != null && list(x.before).length > 0) ||
                  (typeof x.before === 'string' && x.before.trim())),
            ),
        );
      if (!oldShown)
        flags.push({
          sentence: clean,
          severity: 'check',
          problem:
            '"Previously …" needs a cited row that shows the old code (a change row with `was` or `before`, or the commit sentence that says it); cite it or drop the old behavior.',
        });
    }
    // PR or issue links, and scope statements, that only a commit message makes.
    const commitOnly = refs.every((r) => /^(commit:)?[0-9a-f]{7,40}(#\d+)?$/.test(r));
    if (
      commitOnly &&
      /(#\d+|\bPR\s*\d+|\bissue\b|not part of)/i.test(clean) &&
      !/commit message/i.test(clean)
    )
      flags.push({
        sentence: clean,
        severity: 'fix',
        problem:
          'only a commit message says this: write "the commit message says…" or leave it out.',
      });
  }
  // An absence ("not tested", "no … was run") with no row behind it: the logs
  // Tracetoon read are not the whole history (judged contradicted where the
  // session did test it). Not blocking: an environment-scope statement ("tried
  // only on Linux", "verified only with fakes") is fine when a test, request,
  // run or commit row supports it (drafting.md), and a sentence that restates
  // a limits row needs no tag of its own.
  const limitRows = rowsOf(b, 'limits');
  const limitRefs = new Set(limitRows.map((r) => String(r.ref)));
  const limitWords = limitRows.map(
    (r) => new Set(contentWords(`${String(r.limit ?? '')} ${String(r.text ?? '')}`)),
  );
  const restatesLimit = (sentence: string) => {
    const ws = contentWords(sentence);
    return (
      ws.length > 0 &&
      limitWords.some((l) => ws.filter((w) => l.has(w)).length >= Math.min(3, ws.length))
    );
  };
  const supportRef = (r: string) =>
    limitRefs.has(r) ||
    /^(?:T|S|R|V|L|U)\d+$/.test(r) ||
    /^(?:commit:)?[0-9a-f]{7,40}(?:#\d+)?$/.test(r);
  const unrunReceipts = new Set(
    rowsOf(b, 'validation')
      .filter(
        (r) =>
          /^V\d/.test(String(r.check ?? '')) &&
          (r.outcome === 'not-run' || /could not run/i.test(String(r.result ?? ''))),
      )
      .map((r) => String(r.check)),
  );
  for (const unit of proseUnits(body)) {
    const clean = unit.replace(TAG, '').trim();
    const m = ABSENCE.exec(clean);
    if (!m) continue;
    // "not run"/"never executed" also describe code ("the hook is not run for
    // drafts"): an absence only next to words about checking it.
    if (
      !/test|verif|record|exercis/i.test(m[0]) &&
      !/\b(?:tests?|check(?:s|ed)?|suite|validation|hardware|device|live|manual(?:ly)?|end-to-end|e2e|CI|smoke|typecheck|lint|build|verified|session)\b/i.test(
        clean,
      )
    )
      continue;
    const refs = [...unit.matchAll(TAG)].flatMap((m) => tagRefs(m[1]!));
    if (refs.some((r) => supportRef(r) || unrunReceipts.has(r))) continue;
    if (restatesLimit(clean)) continue;
    flags.push({
      sentence: clean,
      severity: 'check',
      problem:
        'unsupported absence: no row is behind it. Tag the limits, test, request or commit row that supports it, or say it in the evidence\'s scope ("the recorded tests use fakes"); keep the uncertainty, never write "untested".',
    });
  }
  // A review pointer that pins a behavior on the wrong function.
  for (const unit of proseUnits(body)) {
    const p = misplacedFocus(unit.replace(TAG, '').trim(), b.owners ?? []);
    if (p) flags.push(p);
  }
  // "Version bump only" / "no logic changes" while the diff changes more.
  for (const unit of proseUnits(body)) {
    const clean = unit.replace(TAG, '').trim();
    const missing = housekeepingOverclaim(clean, b.sections);
    if (missing)
      flags.push({
        sentence: clean,
        severity: 'fix',
        problem: `the diff also changes ${missing.join(', ')}: don't call it housekeeping, a version bump or "no logic changes" only; name what else changed.`,
      });
  }
  // "No passing run after the last commit" next to a Validation section that
  // lists fresh passes from `tracetoon check`: the limit held at prepare time,
  // not after the writer's own checks (r21, judged contradicted).
  const freshPass =
    !!b.freshPass ||
    rowsOf(b, 'validation').some(
      (r) => /^V\d/.test(String(r.check ?? '')) && r.outcome === 'passed',
    );
  if (freshPass)
    for (const unit of proseUnits(body)) {
      const clean = unit.replace(TAG, '').trim();
      if (staleNoPass(clean))
        flags.push({
          sentence: clean,
          severity: 'fix',
          problem:
            'the Validation section shows fresh passing checks run by `tracetoon check` on the submitted content; drop or narrow this sentence.',
        });
    }
  // Behaviors grouped under one test file that another file's titles show.
  const testRows = rowsOf(b, 'tests');
  for (const unit of proseUnits(body)) {
    const p = misattributedTests(unit.replace(TAG, '').trim(), testRows);
    if (p) flags.push(p);
  }
  // Brief refs are for render, not readers: one left in the prose (outside a tag) is noise.
  for (const unit of proseUnits(body)) {
    const clean = unit.replace(TAG, '');
    const leaked = (clean.match(/\b(?:CH|HK|PR|[STLRDPHB])\d+\b/g) ?? []).filter((r) =>
      known.has(r),
    );
    if (leaked.length)
      flags.push({
        sentence: clean.trim(),
        severity: 'fix',
        problem: `${uniqList(leaked).join(', ')} is a brief ref, not something a reader can follow: say what it refers to, and keep refs only in the [tags].`,
      });
  }
  // Brief rows nothing cites: each deserves a sentence.
  const cited = (ref: unknown) => {
    const r = String(ref ?? '').replace(/^commit:/, '');
    return [...cites].some((c) => {
      if (c === r) return true;
      const [a, an] = c.split('#');
      const [x, xn] = r.split('#');
      return (
        /^[0-9a-f]{7,}$/.test(a!) &&
        (an ?? '') === (xn ?? '') &&
        (x!.startsWith(a!) || a!.startsWith(x!))
      );
    });
  };
  const uncovered: string[] = [];
  for (const r of changeRows)
    if (!cited(r.change)) uncovered.push(`${String(r.change)}: ${list(r.where)}`);
  for (const r of commitRows) {
    const text = String(r.text ?? '');
    if (
      !String(r.ref).includes('#') ||
      text.split(/\s+/).length < 4 ||
      text.endsWith(':')
    )
      continue;
    // A sentence is covered by its own ref or by citing the whole commit.
    const whole = String(r.ref).split('#')[0];
    if (!cited(r.ref) && !cited(whole))
      uncovered.push(`${String(r.ref)}: ${clipped(text)}`);
  }
  for (const r of [...rowsOf(b, 'tests'), ...rowsOf(b, 'housekeeping')])
    if (!cited(r.ref))
      uncovered.push(`${String(r.ref)}: ${String(r.file ?? r.what ?? '')}`);
  // Open points: each deserves a sentence saying what the evidence leaves open.
  // A check `tracetoon check` passed on the submitted content answers an open
  // point about a missing or historical pass: it is not left to cover.
  const receiptPassed =
    !!b.freshPass ||
    rowsOf(b, 'validation').some(
      (r) => /^V\d/.test(String(r.check ?? '')) && r.outcome === 'passed',
    );
  // With the Validation marker, render writes every open point there itself.
  const marker = body.includes(VALIDATION_MARKER);
  for (const r of rowsOf(b, 'limits'))
    if (
      !marker &&
      r.kind === 'open' &&
      !cited(r.ref) &&
      !(receiptPassed && PASS_LIMIT.test(String(r.limit ?? '')))
    )
      uncovered.push(`${String(r.ref)} (open point): ${clipped(String(r.limit ?? ''))}`);

  for (const r of rowsOf(b, 'requests'))
    if (String(r.kind ?? '').startsWith('goal') && !cited(r.ref))
      uncovered.push(`${String(r.ref)} (the goal): ${clipped(String(r.text ?? ''))}`);
  flags.push(...bodyFlags(body, b, cites));
  let text = body.replace(TAG, '');
  // The section brings its own heading: drop a writer's heading right above the marker.
  text = text.replace(
    new RegExp(String.raw`^#{1,6}[^\n]*\n(\s*\n)*(?=${VALIDATION_MARKER})`, 'm'),
    '',
  );
  const validation = text.includes(VALIDATION_MARKER);
  if (validation) {
    const section = validationSection(b);
    text = section
      ? text.replace(VALIDATION_MARKER, section)
      : text.replace(`${VALIDATION_MARKER}\n`, '').replace(VALIDATION_MARKER, '');
  }
  text = tidyProse(text);
  return {
    text,
    validation,
    tags,
    unknownRefs: [...unknown].sort(),
    untagged,
    validationClaims,
    unbackedNames,
    uncovered,
    flags,
  };
}

/** Lines that guard a behavior: a branch, a fallback, a condition word. */
const CONDITION =
  /\bif\b|\bwhen\b|\bunless\b|\belse\b|\bexcept\b|\?\?|\|\||&&|\bcase\b|\bfalls? back\b/i;

/** Words about the brief itself: readers never see it. */
const BRIEF_WORDS =
  /\b(?:the (?:evidence )?brief|brief rows?|limits rows?|(?:change|commit|process|validation|request) rows?|Tracetoon read|rows? (?:CH|L|S)\d+)\b/i;
/** A "where to start" pointer for reviewers. */
const START_LINE =
  /\bwhere to start\b|\bstart (?:at|with|in|from|reading|by reading|the review)\b|\bbegin (?:at|with|in)\b|\breview (?:can |should )?(?:start|begin)\b|\bstarting point\b|\bentry point\b|\bread first\b/i;
/** A concrete question for reviewers. */
const FEEDBACK_LINE =
  /\bfeedback (?:wanted|welcome|on|requested)\b|\b(?:reviewers?|review)[^.\n]{0,40}\b(?:please|check|confirm|weigh in|look)\b[^.\n]*\?|\bopen question\b|\bquestion for reviewers\b|\b(?:would like|want) (?:eyes|feedback|input|a second opinion)\b/i;

/**
 * Whole-body checks: the required "Where to start" and "Feedback wanted"
 * lines, the brief's own vocabulary in the prose, and behaviors of cited
 * change units the body never mentions (non-blocking, at most five listed).
 */
export function bodyFlags(
  body: string,
  b: BriefParts,
  cites: Set<string>,
): BriefApplied['flags'] {
  const flags: BriefApplied['flags'] = [];
  const prose = body.split(VALIDATION_MARKER).join('\n').replace(TAG, '');
  const changesText = JSON.stringify(rowsOf(b, 'changes'));
  for (const unit of proseUnits(body)) {
    const clean = unit.replace(TAG, '').trim();
    const m = BRIEF_WORDS.exec(clean);
    if (m)
      flags.push({
        sentence: clean,
        // A PR about briefs may say "brief": then only a check.
        severity: /\bbrief\b/i.test(changesText) ? 'check' : 'fix',
        problem: `"${m[0]}" is the drafting brief's vocabulary, not something a reader has: say what the evidence shows ("the session logs", "the diff") instead.`,
      });
  }
  // The required closing lines, on a full description (a one-line body is a fragment).
  const full = proseUnits(body).length >= 4;
  if (full && !START_LINE.test(prose))
    flags.push({
      sentence: '(no "Where to start" line)',
      severity: 'check',
      problem:
        'add a "Where to start" line: the function and file the `entry` process row names (or a file from `changes.where` when there is none).',
    });
  if (full && !FEEDBACK_LINE.test(prose))
    flags.push({
      sentence: '(no "Feedback wanted" line)',
      severity: 'check',
      problem:
        'add a "Feedback wanted" line: one concrete question for reviewers about a decision or risk in this change.',
    });
  const missed = missedBehaviors(prose, b, cites).slice(0, 5);
  if (missed.length)
    flags.push({
      sentence: '(behaviors of cited changes the description never mentions)',
      severity: 'check',
      problem: `${missed.join('; ')}. Mention each in a clause if a reviewer needs it.`,
    });
  return flags;
}

/** Behavior rows of cited change units whose words the body doesn't use. */
export function missedBehaviors(
  prose: string,
  b: BriefParts,
  cites: Set<string>,
): string[] {
  const bodyWords = wordsOf(prose.replace(/`([^`]*)`/g, ' $1 '));
  const cited = (ref: unknown) => {
    const r = String(ref ?? '').replace(/^commit:/, '');
    return [...cites].some(
      (c) =>
        c === r ||
        (/^[0-9a-f]{7,}/.test(c) &&
          (r.startsWith(c.split('#')[0]!) || c.startsWith(r.split('#')[0]!))),
    );
  };
  const out: string[] = [];
  for (const r of rowsOf(b, 'behaviors')) {
    // Commit sentences only: a behavior line is code, matched poorly by prose.
    if (!/#\d+$/.test(String(r.from ?? ''))) continue;
    if (!cited(r.change) && !cited(r.ref) && !cited(r.from)) continue;
    const text = String(r.text ?? '');
    const words = [...wordsOf(text.replace(/`([^`]*)`/g, ' $1 '))]
      .filter((w) => w.length >= 4 && !TEST_FILLER.has(w))
      .sort((a, b2) => b2.length - a.length)
      .slice(0, 6);
    if (words.length < 2) continue;
    const hit = words.filter((w) => bodyWords.has(w)).length;
    if (hit >= Math.max(2, Math.ceil(words.length * 0.4))) continue;
    out.push(`${String(r.ref)} (${String(r.change)}): ${clipped(text)}`);
  }
  return out;
}

/**
 * Joins the writer's text cleanly once tags are gone: no doubled spaces
 * inside a line, and a sentence after a doubled space starts upper-case.
 * Code fences, indented code and inline code are left alone.
 */
export function tidyProse(text: string): string {
  let fence = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fence = !fence;
        return line;
      }
      if (fence || /^( {4}|\t)/.test(line) || /^\s*\|/.test(line)) return line;
      const lead = /^\s*/.exec(line)![0];
      const parts = line.slice(lead.length).split(/(`[^`]*`)/);
      const out = parts
        .map((p, i) =>
          i % 2
            ? p
            : p
                .replace(
                  /([.!?])\s{2,}([a-z])/g,
                  (_m, end: string, c: string) => `${end} ${c.toUpperCase()}`,
                )
                .replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 '),
        )
        .join('');
      return lead + out;
    })
    .join('\n');
}

/**
 * A title that only restates the head commit's subject when the PR has
 * several commits: it names one commit, not the whole PR.
 */
export function titleFlags(title: string, subjects: string[]): BriefApplied['flags'] {
  const subs = subjects.map((x) => x.trim()).filter(Boolean);
  if (new Set(subs).size < 2) return [];
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const head = norm(subs.at(-1)!);
  const t = norm(title);
  if (!t || !head) return [];
  const tw = [...wordsOf(t)];
  const hw = wordsOf(head);
  const others = wordsOf(subs.slice(0, -1).map(norm).join(' '));
  const fromHead = tw.length > 0 && tw.every((w) => hw.has(w));
  const fromOthers = tw.some((w) => others.has(w) && !hw.has(w));
  // Other commits that add words of their own: the PR is more than its last commit.
  const distinct = [...others].filter((w) => !hw.has(w)).length;
  if (distinct >= 3 && (t === head || (fromHead && !fromOthers)))
    return [
      {
        sentence: `title: ${title}`,
        severity: 'check',
        problem:
          "the title restates the head commit's subject; describe the whole PR (every change unit), not its last commit.",
      },
    ];
  return [];
}

const uniqList = (xs: string[]) => [...new Set(xs)];
const clipped = (s: string) => (s.length > 100 ? `${s.slice(0, 99)}…` : s);

/** "Start at / review `fn`, especially <behavior>": the behavior clause. */
const FOCUS =
  /\b(especially|particularly|in particular|(?:with a )?focus(?:ing)? on|above all|mainly)\b([^.;!?]*)/i;
const POINTER = /\b(start|starting|begin|beginning|review|reviewers?)\b/i;

/**
 * A sentence pointing reviewers at a function (`start`/`begin`/`review` and a
 * backticked function) with an "especially <behavior>" clause, where the
 * behavior's words match what the brief ties to another changed function
 * (its name counts double) better than the named one's: the writer has
 * pinned a caller's or callee's behavior on the entry point.
 */
export function misplacedFocus(
  sentence: string,
  owners: NonNullable<BriefParts['owners']>,
): BriefApplied['flags'][number] | undefined {
  if (!owners.length || !POINTER.test(sentence)) return undefined;
  const focus = FOCUS.exec(sentence);
  if (!focus) return undefined;
  const byName = new Map(owners.map((o) => [o.name, o]));
  const named = [
    ...new Set(
      [...sentence.matchAll(/`([A-Za-z_$][\w$]*)(?:\(\))?`/g)].map((m) => m[1]!),
    ),
  ].filter((n) => byName.has(n));
  if (!named.length) return undefined;
  const behavior = [...wordsOf(focus[2]!.replace(/`[^`]*`/g, ' '))];
  if (!behavior.length) return undefined;
  const score = (o: NonNullable<BriefParts['owners']>[number]) =>
    behavior.reduce(
      (n, w) => n + (o.nameWords.includes(w) ? 2 : 0) + (o.words.includes(w) ? 1 : 0),
      0,
    );
  const mine = Math.max(...named.map((n) => score(byName.get(n)!)));
  const ranked = owners
    .filter((o) => !named.includes(o.name))
    .map((o) => ({ o, n: score(o) }))
    .sort((a, b) => b.n - a.n || a.o.name.localeCompare(b.o.name));
  const top = ranked[0];
  if (!top || top.n < 2 || top.n <= mine) return undefined;
  // Functions that fit equally well: name them all (at most two).
  const rivals = ranked
    .filter((r) => r.n === top.n)
    .slice(0, 2)
    .map((r) => `\`${r.o.name}\` (${r.o.file})`);
  return {
    sentence,
    severity: 'check',
    problem: `"${focus[1]}${clipped(focus[2]!).trimEnd()}": the brief ties that to ${rivals.join(' or ')}, not to ${named.map((n) => `\`${n}\``).join(', ')}. Name the function that owns it, or drop the clause.`,
  };
}

/**
 * "No passing/successful run (or check, test) … after the last commit/edit":
 * true before `tracetoon check` ran, stale once a receipt passed on the
 * submitted content.
 */
export function staleNoPass(sentence: string): boolean {
  return (
    /\bno\b[^.;!?]{0,60}?\b(?:passing|successful|green|passed)\b[^.;!?]{0,60}?\bafter\s+the\s+(?:last|latest|final)\s+(?:\w+\s+)?(?:commit|edit|change)s?\b/i.test(
      sentence,
    ) && /\b(?:runs?|checks?|tests?|suites?)\b/i.test(sentence)
  );
}

const TEST_VERB =
  /\b(?:cover(?:s|ed|ing)?|check(?:s|ed|ing)?|test(?:s|ed|ing)?|assert(?:s|ed|ing)?|verif(?:y|ies|ied|ying)|exercis(?:e|es|ed|ing)|pin(?:s|ned)?)\b/i;
/** Words that say a test exists, not what it checks. */
const TEST_FILLER = wordsOf(
  'cover covers covered check checks checked test tests tested assert asserts verify verifies exercise exercises case cases also both these those each new',
);
const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A test file's short name: `tests/summary-fix.test.ts` → `summary-fix`. */
function testStem(file: string): string {
  return (file.split('/').pop() ?? file)
    .replace(/\.[^.]+$/, '')
    .replace(/[._-](?:test|spec)s?$/i, '')
    .replace(/^test_/i, '');
}

/**
 * A sentence that names a test file (its path, its file name, or "the <name>
 * tests") and says what it covers, where a listed behavior matches another
 * test file's titles clearly better than the named file's: the writer grouped
 * behaviors from several files under one. Conservative: a behavior phrase
 * needs two words in one title of the other file, and two more than the
 * named file's best title.
 */
export function misattributedTests(
  sentence: string,
  tests: Record<string, unknown>[],
): BriefApplied['flags'][number] | undefined {
  const files = tests
    .map((r) => ({
      file: String(r.file ?? ''),
      titles: (Array.isArray(r.titles) ? r.titles : []).map((t) => wordsOf(String(t))),
    }))
    .filter((f) => f.file && f.titles.length);
  if (files.length < 2) return undefined;
  // Where each file is named.
  const mentions: { at: number; end: number; file: (typeof files)[number] }[] = [];
  for (const f of files) {
    const stem = testStem(f.file);
    const pats = [
      escRe(f.file),
      escRe(f.file.split('/').pop()!),
      ...(stem.length >= 3
        ? [
            String.raw`\b${stem
              .split(/[-_\s]+/)
              .map(escRe)
              .join(String.raw`[-_\s]`)}\s+tests?\b`,
          ]
        : []),
    ];
    for (const pat of pats)
      for (const m of sentence.matchAll(new RegExp(`\`?${pat}\`?`, 'gi')))
        if (!mentions.some((x) => m.index! < x.end && x.at < m.index! + m[0].length))
          mentions.push({ at: m.index!, end: m.index! + m[0].length, file: f });
  }
  if (!mentions.length) return undefined;
  mentions.sort((a, b) => a.at - b.at);
  const score = (f: (typeof files)[number], words: string[]) =>
    Math.max(0, ...f.titles.map((t) => words.filter((w) => t.has(w)).length));
  for (const [i, m] of mentions.entries()) {
    // The named file's part of the sentence: up to the next file named.
    const part =
      sentence.slice(i === 0 ? 0 : m.at, m.at) +
      ' ' +
      sentence.slice(m.end, mentions[i + 1]?.at ?? sentence.length);
    if (!TEST_VERB.test(part)) continue;
    for (const phrase of part.split(/[,;:()]|\band\b|\bor\b|\bplus\b/i)) {
      const words = [
        ...wordsOf(phrase.replace(/`[^`]*`/g, (c) => c.slice(1, -1))),
      ].filter((w) => !TEST_FILLER.has(w));
      if (words.length < 2) continue;
      const mine = score(m.file, words);
      const ranked = files
        .filter((f) => f !== m.file)
        .map((f) => ({ f, n: score(f, words) }))
        .sort((a, b) => b.n - a.n || a.f.file.localeCompare(b.f.file));
      const top = ranked[0];
      if (!top || top.n < 2 || top.n < mine + 2 || top.n < Math.ceil(words.length * 0.6))
        continue;
      if (ranked[1]?.n === top.n) continue; // no single better file
      return {
        sentence,
        severity: 'check',
        problem: `"${phrase.trim()}": the test titles in ${top.f.file} show that, not ${m.file.file}'s. Attribute each tested behavior to the test file whose titles show it; don't group them under one file.`,
      };
    }
  }
  return undefined;
}
