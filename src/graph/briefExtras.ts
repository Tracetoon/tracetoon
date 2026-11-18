/**
 * Brief rows built from facts the other sections already hold, kept apart so
 * the main brief query stays readable:
 * - open points a writer should state (`limits` rows): no passing run after
 *   the last commit, a failed publishing command, added remote-call branches
 *   no recorded run shows running live;
 * - the entry point: the changed function that owns the behavior, by the
 *   other changed symbols its new lines call;
 * - the cap on `limits` rows.
 * Generic rules over graph facts only; each row is short and cites its refs.
 */
import type { GraphEngine } from './engine.ts';
import { fileRole as pathRole } from '../digest/build.ts';
import { unitRole } from './build.ts';
import { wordsOf } from './codeEvidence.ts';

type Row = Record<string, unknown>;

/** At most this many `limits` rows: each needs a clause in the PR. */
export const MAX_LIMITS = 9;

const shortSha = (s: unknown) => String(s ?? '').slice(0, 12);

/**
 * The PR files a captured edit (in an included session) changed after `from`
 * and no later than `to`, by name. Empty means the logs show nothing changing
 * in between: a pass at `from` saw what was committed at `to`.
 */
export function editsBetween(g: GraphEngine): (from: string, to: string) => string[] {
  const edits = g
    .run(
      `MATCH (e:Edit)-[:EDITS]->(f:File {inPr: true})
       MATCH (e)-[:IN_SESSION]->(:Session {band: 'included'})
       WHERE e.t IS NOT NULL RETURN e.t AS t, f.id AS file`,
    )
    .rows.map((e) => ({ t: String(e.t), file: String(e.file) }));
  return (from, to) =>
    [...new Set(edits.filter((e) => e.t > from && e.t <= to).map((e) => e.file))].sort();
}

/**
 * "No passing run after the last commit", when it holds: the session's check
 * runs (this PR's turns) all came before the last commit, or none passed after,
 * and every pass was followed by a captured edit of a PR file before that
 * commit. A pass with no captured edit between it and the commit gives no row:
 * a "historical session run, not re-run" point beside a row saying nothing
 * changed in between invited needless hedging (r1, Claude Code writers).
 */
export function noPassAfterCommitRow(g: GraphEngine, scopedRuns: Row[]): Row | undefined {
  if (!scopedRuns.length) return undefined;
  const last = g
    .run('MATCH (k:Commit) WHERE k.t IS NOT NULL RETURN k.id AS id, k.t AS t')
    .rows.sort(
      (a, b) =>
        String(b.t).localeCompare(String(a.t)) ||
        String(a.id).localeCompare(String(b.id)),
    )[0];
  if (!last) return undefined;
  const passed = scopedRuns.filter((r) => r.outcome === 'passed');
  if (passed.some((r) => String(r.t ?? '') > String(last.t))) return undefined;
  const between = editsBetween(g);
  const editedBetween = (r: Row) => between(String(r.t ?? ''), String(last.t));
  // A pass with no captured edit between it and the last commit covers the
  // commit (an inferred shell write would count as an edit).
  if (passed.some((r) => r.t && !editedBetween(r).length)) return undefined;
  const lastPass =
    [...passed]
      .sort((a, b) => String(a.t ?? '').localeCompare(String(b.t ?? '')))
      .filter((r) => r.kind === 'test')
      .at(-1) ?? passed.at(-1);
  const changed = lastPass ? editedBetween(lastPass) : [];
  return {
    change: null,
    kind: 'open',
    limit: `No passing check run was recorded after the last commit (${shortSha(last.id)})${
      lastPass
        ? `; the last pass (${String(lastPass.id)}, ${String(lastPass.kind)}) came before it`
        : ''
    }${
      changed.length
        ? `, and ${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ` and ${changed.length - 3} more` : ''} changed between them`
        : ''
    }.`,
  };
}

/** Commands that publish, push or deploy: their failure leaves open what reached the remote. */
const PUBLISHING =
  /^(?:gh\s+(?:pr|release|repo|workflow)|git\s+push|(?:npm|pnpm|bun|yarn(?:\s+npm)?)\s+publish|cargo\s+publish|twine\s+upload|poetry\s+publish|gem\s+push|docker\s+push|helm\s+(?:install|upgrade)|kubectl\s+(?:apply|rollout)|terraform\s+apply|vercel|netlify|fly(?:ctl)?\s+deploy|wrangler|firebase\s+deploy|\S+\s+deploy)\b/i;

/** `failedCmds` entries are `<cmd> (failed N of M)`; older graphs have only `failedCommand`. */
const parseFailed = (s: string) => {
  const m = /^(.*?)\s+\(failed (\d+) of (\d+)\)$/.exec(s);
  return m
    ? { cmd: m[1]!, failures: Number(m[2]), count: Number(m[3]) }
    : { cmd: s, failures: 1, count: 0 };
};

/** A failed command that publishes, pushes or deploys, from the included sessions. */
export function failedPublishRows(g: GraphEngine): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const s of g
    .run(
      `MATCH (s:Session {band: 'included'})
       RETURN s.id AS id, s.agent AS agent, s.failedCmds AS cmds, s.failedCommand AS one`,
    )
    .rows.sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const cmds = Array.isArray(s.cmds)
      ? (s.cmds as string[])
      : s.one
        ? [String(s.one)]
        : [];
    for (const c of cmds.map(parseFailed)) {
      if (!PUBLISHING.test(c.cmd.trim()) || seen.has(c.cmd)) continue;
      seen.add(c.cmd);
      const again = c.count > c.failures;
      out.push({
        change: null,
        kind: 'open',
        limit: again
          ? `\`${c.cmd}\` failed ${c.failures} of ${c.count} times in the ${String(s.agent)} session; which attempt published or pushed what isn't recorded.`
          : `\`${c.cmd}\` failed in the ${String(s.agent)} session; whether or how the work was then published or pushed isn't recorded.`,
      });
    }
  }
  return out.slice(0, 2);
}

/** Words of code that reaches a remote service or external program. */
const REMOTE_CODE = new Set([
  'fetch',
  'http',
  'https',
  'axios',
  'socket',
  'websocket',
  'webhook',
  'bearer',
  'authorization',
  'grpc',
  'curl',
]);
/** Words of a path or name about a remote route. */
const REMOTE_NAME =
  /\b(?:providers?|routes?|remote|clients?|api|http|network|endpoints?|servers?|upload|download|webhooks?|services?|gateway|fetch)\b/i;
const splitName = (s: string) =>
  s
    .replace(/\.[^./]+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z]+/g, ' ');

/** Recorded commands that ran something (Session `invoked`), and the code they could reach. */
export interface LiveEvidence {
  invocations: { cmd: string; out: string[] }[];
  /** Source hunks: file, scope, touched, symbols, fresh, code (added lines). */
  hunks: Row[];
}

/** What `remotePathRows` needs to see live runs: included sessions' commands and the source hunks. */
export function liveEvidence(g: GraphEngine): LiveEvidence {
  const invocations: LiveEvidence['invocations'] = [];
  for (const s of g.run(
    `MATCH (s:Session {band: 'included'}) RETURN s.invoked AS cmds, s.invokedOut AS out`,
  ).rows) {
    const outs = ((s.out as string[]) ?? []).map(String);
    ((s.cmds as string[]) ?? []).forEach((c, i) =>
      invocations.push({
        cmd: String(c),
        out: (outs[i] ?? '').split(' ').filter(Boolean),
      }),
    );
  }
  const hunks = g.run(
    `MATCH (h:Hunk) RETURN h.file AS file, h.scope AS scope, h.touched AS touched,
            h.symbols AS symbols, h.fresh AS fresh, h.code AS code`,
  ).rows;
  return { invocations, hunks };
}

const lowerWords = (s: string) =>
  (s.match(/[A-Za-z][a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? []).map((w) => w.toLowerCase());
/** Words of a command's bare arguments: tokens that are not paths or file names. */
const bareWords = (cmd: string) =>
  cmd
    .split(/\s+/)
    .filter((t) => !/[/\\.~:]/.test(t))
    .flatMap(lowerWords);
/** Name words that only say "this is a command handler". */
const HANDLER_WORD = new Set(['cmd', 'command', 'handler', 'action', 'run', 'main']);
const HANDLER = /(?:Cmd|Command|Handler|Action)$/;

/** Literal values a remote file's changed branches choose between (`id === 'gemini'`, `case 'openai'`). */
function routesOf(conds: string[]): string[] {
  const byVar = new Map<string, Set<string>>();
  const cases = new Set<string>();
  for (const c of conds) {
    for (const m of c.matchAll(/([\w$.]+)\s*[!=]==?\s*'([a-z][\w-]{2,})'/g)) {
      const v = m[1]!.split('.').pop()!;
      byVar.set(v, (byVar.get(v) ?? new Set()).add(m[2]!));
    }
    for (const m of c.matchAll(/\bcase\s+'([a-z][\w-]{2,})'/g)) cases.add(m[1]!);
  }
  const top = [...byVar.values()].sort((a, b) => b.size - a.size)[0];
  if (!top || top.size < 2) return [];
  return [...new Set([...top, ...cases])].sort();
}

/**
 * Two forms of one word: equal, or sharing all but the last letter of the
 * shorter one and at least five letters (`compare` / `comparison`, `upload` /
 * `uploader`).
 */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n < 5) return false;
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i >= 5 && i >= n - 1;
}

/**
 * The recorded commands that reach a remote file's changed code: a command
 * whose words name a changed command handler (`comicArtCmd` ← `… comic art`)
 * in a file whose changed lines call that file's changed symbols (or in the
 * file itself), or name such a calling file (`comic.ts` ← `… comic …`).
 * Matching by words leans toward "reached": a wrong match drops a limit, it
 * never claims one.
 */
function reachingRuns(file: string, live: LiveEvidence): LiveEvidence['invocations'] {
  if (!live.invocations.length) return [];
  const own = live.hunks.filter((h) => String(h.file) === file);
  const defined = new Set(
    own
      .flatMap((h) => [
        ...((h.symbols as string[]) ?? []),
        ...((h.fresh as string[]) ?? []),
        ...((h.touched as string[]) ?? []),
      ])
      .map(String)
      .filter((x) => x.length >= 4),
  );
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const calls = (code: unknown) => {
    const text = addedCode(code);
    return [...defined].some((d) => new RegExp(`\\b${esc(d)}\\b`).test(text));
  };
  // Files that reach the remote file: itself, and those whose added lines name its symbols.
  const reaching = new Set([
    file,
    ...live.hunks
      .filter((h) => String(h.file) !== file && calls(h.code))
      .map((h) => String(h.file)),
  ]);
  const handlers = live.hunks
    .filter((h) => reaching.has(String(h.file)))
    .flatMap((h) => [h.scope, ...((h.touched as string[]) ?? [])])
    .filter((x): x is string => typeof x === 'string' && HANDLER.test(x))
    .map((x) => lowerWords(x).filter((w) => !HANDLER_WORD.has(w)))
    .filter((ws) => ws.length);
  const fileWords = [...reaching]
    .filter((f) => f !== file && unitRole(f, pathRole(f)) === 'src')
    .map((f) => lowerWords((f.split('/').pop() ?? '').replace(/\.[^.]+$/, '')))
    .filter((ws) => ws.length && ws.every((w) => w.length >= 4));
  return live.invocations.filter((inv) => {
    // Bare arguments only (subcommands, values): a path argument (a formatter
    // given `src/commands/comic.ts`) runs nothing of that file.
    const words = [...new Set(bareWords(inv.cmd))];
    return [...handlers, ...fileWords].some((ws) =>
      ws.every((w) => words.some((c) => sameWord(c, w))),
    );
  });
}

/**
 * Added branches in a source file that calls out to a remote service (its
 * changed lines fetch, use http or a socket, and its path or symbols name a
 * provider, route, client or API) and that no recorded check run's command
 * names: tests and checks don't show those paths running against the real
 * service. Conservative: both signals, added branches, at most two files.
 * A recorded command that reaches the file's code (`reachingRuns`) ran it
 * live: the row then names only the routes (`id === 'x'` values) no such
 * run names, when every such run names its route; otherwise it is dropped.
 */
export function remotePathRows(
  hunkRows: Row[],
  fileRole: Map<string, string>,
  scopedRuns: Row[],
  live?: LiveEvidence,
): Row[] {
  const byFile = new Map<string, Row[]>();
  for (const h of hunkRows) {
    const f = String(h.file);
    if (unitRole(f, fileRole.get(f) ?? pathRole(f)) !== 'src') continue;
    byFile.set(f, [...(byFile.get(f) ?? []), h]);
  }
  const cmds = scopedRuns.map((r) => String(r.cmd ?? '')).join('\n');
  const out: {
    file: string;
    change: string;
    branches: number;
    syms: string[];
    open?: { routes: string[]; used: string[]; cmd: string };
  }[] = [];
  for (const [file, hs] of [...byFile].sort((a, b) => a[0].localeCompare(b[0]))) {
    const branches = hs.reduce((n, h) => n + Number(h.branches ?? 0), 0);
    if (!branches) continue;
    const words = new Set(hs.flatMap((h) => ((h.words as string[]) ?? []).map(String)));
    if (![...REMOTE_CODE].some((w) => words.has(w))) continue;
    const syms = [
      ...new Set(
        hs
          .filter((h) => Number(h.branches ?? 0) > 0)
          .flatMap((h) => ((h.symbols as string[]) ?? []).map(String)),
      ),
    ].filter((x) => /[a-z][A-Z]|_/.test(x) || x.length >= 8);
    const named = [file.split('/').pop() ?? '', ...syms].map(splitName).join(' ');
    if (!REMOTE_NAME.test(named)) continue;
    const stem = (file.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
    if (
      stem.length >= 3 &&
      new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(cmds)
    )
      continue;
    const top = [...hs].sort(
      (a, b) => Number(b.branches ?? 0) - Number(a.branches ?? 0),
    )[0]!;
    const row = { file, change: String(top.change), branches, syms: syms.slice(0, 3) };
    const ran = live ? reachingRuns(file, live) : [];
    if (ran.length) {
      // Live runs reached this code: only routes none of them names stay open.
      const routes = routesOf(
        hs.flatMap((h) => ((h.conds as string[]) ?? []).map(String)),
      );
      const usedBy = ran.map((inv) => {
        const ws = new Set([...bareWords(inv.cmd), ...inv.out]);
        return routes.filter((r) => lowerWords(r).every((w) => ws.has(w)));
      });
      const used = [...new Set(usedBy.flat())].sort();
      // A run naming no route may have taken any: unsure, so no row.
      if (!routes.length || usedBy.some((u) => !u.length) || used.length >= routes.length)
        continue;
      out.push({
        ...row,
        open: {
          routes: routes.filter((r) => !used.includes(r)),
          used,
          cmd: ran.find((inv, i) => usedBy[i]!.length)!.cmd,
        },
      });
      continue;
    }
    out.push(row);
  }
  const ticks = (xs: string[]) => xs.map((s) => `\`${s}\``).join(', ');
  return out
    .sort((a, b) => b.branches - a.branches || a.file.localeCompare(b.file))
    .slice(0, 2)
    .map((x) => ({
      change: x.change,
      kind: 'open',
      limit: x.open
        ? `${x.file} adds branches that call a remote service; the recorded run of \`${x.open.cmd}\` used ${ticks(x.open.used)}, and no recorded run shows ${ticks(x.open.routes)} running against the real service.`
        : `${x.file} adds branches that call a remote service${x.syms.length ? ` (${ticks(x.syms)})` : ''}; no recorded check run shows those paths running against the real service.`,
    }));
}

/**
 * At most MAX_LIMITS rows. Over the cap, the lowest-priority rows go first:
 * the remote-path rows, then the "no request recorded" row, then the tail.
 */
export function capLimits(
  existing: Row[],
  extra: Row[],
  remote: Row[],
  max = MAX_LIMITS,
): Row[] {
  let all = [...existing, ...extra, ...remote];
  const drop = (pred: (r: Row) => boolean) => {
    while (all.length > max) {
      const i = all.findLastIndex(pred);
      if (i < 0) return;
      all.splice(i, 1);
    }
  };
  drop((r) => remote.includes(r));
  drop((r) => /^No user request was recorded/.test(String(r.limit ?? '')));
  return all.slice(0, max);
}

/** Platforms a changed line can be specific to, by the names code uses for them. */
const PLATFORMS: { name: string; host: string; re: RegExp }[] = [
  {
    name: 'Windows',
    host: 'win32',
    re: /\bwin32\b|\bwindows\b|\bIS_WINDOWS\b|\bisWindows\b|\bIsWindows\b|cfg!?\(\s*windows/i,
  },
  {
    name: 'macOS',
    host: 'darwin',
    re: /\bdarwin\b|\bmacos\b|\bisMac\w*\b|\bIS_MAC\b|\bIsMacOS\b/i,
  },
  { name: 'arm64', host: 'arm64', re: /\barm64\b|\baarch64\b/i },
  { name: 'x64', host: 'x64', re: /\bx64\b|\bx86_64\b|\bamd64\b/i },
];
/** A platform as a value a test can pass in (`platform: 'win32'`). */
const PLATFORM_VALUE: Record<string, RegExp> = {
  Windows: /^(?:win32|win64|windows(?:_nt)?)$/i,
  macOS: /^(?:darwin|macos|osx)$/i,
  arm64: /^(?:arm64|aarch64)$/i,
  x64: /^(?:x64|x86_64|amd64)$/i,
};
/** A test of the running OS or CPU: what makes a line platform-specific. */
const PLATFORM_TEST =
  /\bprocess\.(?:platform|arch)\b|\bos\.(?:platform|arch|type)\(\)|\bsys\.platform\b|\bplatform\.(?:system|machine)\(\)|\bos\.name\b|\bruntime\.GOOS\b|\bruntime\.GOARCH\b|\bcfg!?\(\s*(?:windows|unix|target_os|target_arch)|#\s*if(?:def)?\s+_WIN32|\$Is(?:Windows|MacOS|Linux)\b|\$env:OS\b|\$\(?uname\b|\bRUNNER_OS\b|\brunner\.os\b|\bOSTYPE\b|\bis(?:Windows|Mac\w*|Linux)\b|\bIS_(?:WINDOWS|MAC|LINUX)\b|\b(?:platform|arch|os|hostOs|targetOs)\s*(?:[!=]==?|-eq|-ne)\s*['"]|['"]\w+['"]\s*[!=]==?\s*(?:platform|arch|os)\b/;
const CONDITIONAL =
  /\bif\b|\belif\b|\bwhen\b|\bcase\b|\bswitch\b|\bmatch\b|\?|&&|\|\||\bunless\b|\bthen\b/;
/** A ternary or table that maps a platform to a name (an asset suffix), not a branch. */
const MAPPING = /\?\s*(['"`])[^'"`]*\1\s*:\s*(?:(['"`])[^'"`]*\2|[\w$.]+)\s*[;,)]?\s*$/;
/** A Windows path or a Windows shell invoked. */
const WINDOWS_ONLY =
  /['"`][A-Za-z]:\\\\|%(?:APPDATA|LOCALAPPDATA|USERPROFILE|ProgramFiles|SystemRoot)%|\$env:(?:APPDATA|LOCALAPPDATA|USERPROFILE)\b|\b(?:pwsh|powershell)(?:\.exe)?\s+-|\bcmd(?:\.exe)?\s+\/[cC]\b|(?:^|[\s&])\.?[\\/][\w./\\-]+\.(?:ps1|bat|cmd)\b/i;
/** A CI workflow line that picks a runner OS or CPU. */
const WORKFLOW_PLATFORM =
  /\bruns-on:|\bos:|^[+-]?\s*-\s*(?:windows|macos|ubuntu)-[\w.-]+\s*$|\brunner\.os\b|\bmatrix\.os\b|\bplatform:|\barch:/i;
const WORKFLOW_FILE =
  /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)azure-pipelines\.ya?ml$/;
/** A script for Windows shells: the whole file is Windows-specific. */
const WINDOWS_SCRIPT = /\.(?:ps1|psm1|bat|cmd)$/i;
/** A script a shell or interpreter runs directly. */
const SCRIPT_FILE = /\.(?:sh|bash|zsh|ps1|psm1|bat|cmd)$/i;
/** A code file a package.json script can run. */
const CODE_SCRIPT = /\.(?:[cm]?[jt]sx?|py|rb|sh|ps1)$/i;

const addedLines = (h: Row) =>
  ((h.code as string[]) ?? [])
    .map(String)
    .map((l) => (l.includes('⇒') ? l.split('⇒').pop()!.trim() : l))
    .filter((l) => l.startsWith('+ '))
    .map((l) => l.slice(2));

/**
 * The platforms a changed line is specific to: a condition on the running
 * OS or CPU that names one, a Windows path or shell, a CI runner pick. Never a
 * line that only maps a platform to a name, nor a file name in a list.
 */
export function platformsOfLine(line: string, file: string): string[] {
  const l = line.replace(/\/\/.*$|#(?![!\s]*if).*$/, '').trim();
  if (!l) return [];
  const out = new Set<string>();
  if (WORKFLOW_FILE.test(file)) {
    if (WORKFLOW_PLATFORM.test(l))
      for (const p of PLATFORMS) if (p.re.test(l)) out.add(p.name);
    return [...out];
  }
  if (PLATFORM_TEST.test(l) && CONDITIONAL.test(l) && !MAPPING.test(l))
    for (const p of PLATFORMS) if (p.re.test(l)) out.add(p.name);
  if (WINDOWS_ONLY.test(l)) out.add('Windows');
  return [...out];
}

/** A test line that replaces a real step with a fake. */
const FAKE =
  /\b(?:mock\w*|stub\w*|fake\w*|spyOn|jest\.fn|vi\.fn|sinon|nock|msw|monkeypatch|httpretty|responses\.add|patch\(|MagicMock|override\w*)\b/i;
/** What a fake stands in for: the network, an install, a process, hardware. */
const FAKED_STEP: [string, RegExp][] = [
  [
    'network or remote calls',
    /\b(?:fetch|http|https|request|axios|socket|api|endpoint|server|remote|download|upload|url)\b/i,
  ],
  [
    'installs or package managers',
    /\b(?:install\w*|npm|brew|apt|dnf|pip|cargo|winget|choco)\b/i,
  ],
  [
    'spawned processes',
    /\b(?:spawn\w*|exec\w*|child_process|subprocess|Popen|runCommand)\b/i,
  ],
  [
    'hardware or devices',
    /\b(?:device|hardware|serial|usb|camera|gpio|bluetooth|sensor|robot|printer)\b/i,
  ],
];
/** Names a fake line gives the double or the thing it replaces. */
const FAKE_NAME =
  /\b((?:mock|stub|fake)[A-Z_]\w*|\w+(?:Mock|Stub|Fake)\b)|\b(?:vi|jest)\.mock\(\s*['"]([^'"]+)['"]|\bspyOn\(\s*[\w$.]+\s*,\s*['"](\w+)['"]|\bmock\.module\(\s*['"]([^'"]+)['"]/g;
/** A source file that is itself a test double. */
const DOUBLE_FILE = /(^|[/_.-])(?:fakes?|mocks?|stubs?)(?=[/_.-]|$)/i;
/**
 * Terminal code: a TTY test, raw mode, termios or a pseudo-terminal API. Words
 * like "interactive", "prompt" or "stdin" in prose, prompts or instructions
 * are not terminal handling.
 */
const TTY_CODE =
  /\.isTTY\b|\bisatty\b|\bsetRawMode\b|\btermios\b|\btc[gs]etattr\b|\b(?:open|fork)pty\b|\bpty\.(?:spawn|fork|openpty)\b|\btty\.(?:ReadStream|WriteStream|isatty|setraw|setcbreak)\b|\bIsTerminal\b|\bterm\.MakeRaw\b|\b(?:enable|disable)_raw_mode\b|\bGetConsoleMode\b|\bSetConsoleMode\b/;
/** Added code lines with string literals and line comments removed. */
export function ttyCodeLines(lines: string[]): string[] {
  return lines.filter((l) => {
    if (/^\s*(?:\/\/|#|\*|\/\*|--|<!--)/.test(l)) return false;
    const code = l
      .replace(/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""')
      .replace(/\s\/\/.*$|\s#.*$/, '');
    return TTY_CODE.test(code);
  });
}

const hunkText = (h: Row) =>
  [...((h.code as string[]) ?? []), ...((h.conds as string[]) ?? [])]
    .map(String)
    .join('\n');
const shown = (files: string[], n = 3) =>
  `${files.slice(0, n).join(', ')}${files.length > n ? ` and ${files.length - n} more` : ''}`;
const joinNames = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

/**
 * Open points about the environment the recorded runs could not reach: code
 * specific to an OS or architecture other than the session's (one row per
 * change unit, platforms merged), changed runnable scripts (a shell or
 * PowerShell/batch file, a file with a shebang, a target a changed
 * package.json script names) that no session command ran and no changed test
 * names, CI workflows when the logs record no CI results (`ciSeen`), behavior the changed tests reach only through fakes, and
 * changed interactive (TTY) paths. Each says what the evidence shows, never
 * "untested". `ran` is the text of every command the included sessions ran;
 * undefined when no session was matched (no script rows then).
 */
export function environmentRows(
  hunks: Row[],
  fileRole: Map<string, string>,
  host: { platform: string; arch: string } = {
    platform: process.platform,
    arch: process.arch,
  },
  ran?: string[],
  ciSeen = false,
  /**
   * Remote CI runs that passed on a runner platform (`gh run watch`, `gh pr
   * checks`, …), with when they were looked at, and each file's last captured
   * edit: a platform passed in CI after a unit's last edit is a run there.
   */
  ci: CiRun[] = [],
  lastEdit: Map<string, string> = new Map(),
  /** Recorded commands and the code they reach: a live run answers a faked path. */
  live?: LiveEvidence,
  /**
   * Per changed file, the workflow files (base names) whose steps run it: a
   * CI result for such a workflow is a run of the script.
   */
  ciCallers: Map<string, string[]> = new Map(),
): Row[] {
  const role = (f: string) => unitRole(f, fileRole.get(f) ?? pathRole(f));
  const code = (f: string) =>
    ['src', 'scripts'].includes(role(f)) || WORKFLOW_FILE.test(f) || SCRIPT_FILE.test(f);
  const src = hunks.filter((h) => role(String(h.file)) === 'src');
  const tests = hunks.filter((h) => role(String(h.file)) === 'tests');
  const out: Row[] = [];
  const foreign = (name: string) => {
    const p = PLATFORMS.find((x) => x.name === name)!;
    return p.host !== host.platform && p.host !== host.arch;
  };
  // Per change unit: its platforms, files and one line that shows it.
  const units = new Map<
    string,
    { names: Set<string>; files: Set<string>; line?: string }
  >();
  for (const h of hunks) {
    const file = String(h.file);
    if (!code(file) || role(file) === 'tests' || DOUBLE_FILE.test(file)) continue;
    const key = String(h.change ?? '');
    const names = new Set<string>();
    let line: string | undefined;
    if (WINDOWS_SCRIPT.test(file)) names.add('Windows');
    for (const l of addedLines(h)) {
      const ps = platformsOfLine(l, file).filter(foreign);
      // A message that names a command is no example of the code.
      if (
        ps.length &&
        !line &&
        !/^(?:echo|printf|Write-Host|console\.\w+|print)\b/.test(l)
      )
        line = l;
      for (const p of ps) names.add(p);
    }
    const kept = [...names].filter(foreign);
    if (!kept.length) continue;
    const u = units.get(key) ?? { names: new Set(), files: new Set() };
    kept.forEach((n) => u.names.add(n));
    u.files.add(file);
    u.line ??= line;
    units.set(key, u);
  }
  // A CI run of a workflow file runs on the platforms that file's changed
  // lines pick (`runs-on: windows-latest`), besides the runner labels its
  // output shows.
  const wfBase = (f: string) => f.split('/').pop()!.toLowerCase();
  const wfOs = new Map<string, Set<string>>();
  for (const h of hunks) {
    const f = String(h.file);
    if (!WORKFLOW_FILE.test(f)) continue;
    const set = wfOs.get(wfBase(f)) ?? new Set<string>();
    for (const l of addedLines(h)) for (const p of platformsOfLine(l, f)) set.add(p);
    for (const l of addedLines(h))
      for (const m of l.matchAll(/\b(windows|macos|ubuntu)-(?:latest|\d[\w.]*)/gi))
        set.add(
          m[1]!.toLowerCase() === 'windows'
            ? 'Windows'
            : m[1]!.toLowerCase() === 'macos'
              ? 'macOS'
              : 'Linux',
        );
    wfOs.set(wfBase(f), set);
  }
  const testLiterals = tests.flatMap((h) =>
    [...hunkText(h).matchAll(/(['"`])([\w.-]{2,20})\1/g)].map((m) => m[2]!),
  );
  const testsPassPlatform = (n: string) =>
    testLiterals.some((x) => PLATFORM_VALUE[n]?.test(x));
  const viaWorkflow = (x: CiRun, n: string) =>
    (x.workflows ?? []).filter((w) => wfOs.get(w.toLowerCase())?.has(n));
  const ranOn = (x: CiRun, n: string) =>
    x.os.includes(n) || (x.ran ?? []).includes(n) || viaWorkflow(x, n).length > 0;
  const passedOn = (x: CiRun, n: string) =>
    x.os.includes(n) || (!x.failed && viaWorkflow(x, n).length > 0);
  const ciLabel = (xs: CiRun[], n: string) => {
    const wfs = [...new Set(xs.flatMap((x) => viaWorkflow(x, n)))].sort();
    return wfs.length ? ` (${wfs.join(', ')})` : '';
  };
  for (const [change, u] of [...units].slice(0, 3)) {
    const files = [...u.files].sort();
    const lastFile = files
      .filter((f) => lastEdit.has(f))
      .sort((a, b) => lastEdit.get(a)!.localeCompare(lastEdit.get(b)!))
      .at(-1);
    const edited = lastFile ? lastEdit.get(lastFile) : undefined;
    const after = (x: CiRun) => !edited || x.t >= edited;
    const all = PLATFORMS.map((p) => p.name).filter((n) => u.names.has(n));
    // A platform passed in CI after the unit's last edit: a run there.
    // A changed test that passes the platform in as a value ('win32') runs
    // that path on any host: no "none shows the path" point for it.
    const names = all.filter(
      (n) => !ci.some((x) => passedOn(x, n) && after(x)) && !testsPassPlatform(n),
    );
    if (!names.length) continue;
    const clauses: string[] = [];
    const none: string[] = [];
    for (const n of names) {
      const runs = ci.filter((x) => ranOn(x, n));
      const late = runs.filter(after);
      if (late.length)
        clauses.push(
          edited
            ? `the ${n} CI run${ciLabel(late, n)} after the last edit${lastFile ? ` of ${lastFile}` : ''} failed`
            : `the recorded ${n} CI run${ciLabel(late, n)} failed`,
        );
      else if (runs.length)
        clauses.push(
          `a ${n} CI run${ciLabel(runs, n)} came before the last edit${lastFile ? ` of ${lastFile}` : ''}; none after`,
        );
      else none.push(n);
    }
    if (none.length)
      clauses.push(
        `the recorded runs were on ${host.platform}/${host.arch}${
          clauses.length ? ' and in that CI' : ''
        }, so none shows the ${joinNames(none)} path${none.length > 1 ? 's' : ''} running`,
      );
    out.push({
      change: change || null,
      kind: 'open',
      limit: `${shown(files)} change${files.length === 1 ? 's' : ''} ${joinNames(names)}-specific code${
        u.line ? ` (\`${clipLine(u.line, 80)}\`)` : ''
      }; ${clauses.join('; ')}.`,
    });
  }
  // Changed scripts and CI workflows no recorded command ran.
  if (ran) {
    const said = ran.join('\n').toLowerCase();
    const base = (f: string) => f.split('/').pop()!.toLowerCase();
    const scripts = new Map<string, string[]>();
    const workflows = new Map<string, string[]>();
    // Text of the changed tests and of changed package.json scripts: a module
    // a test names is driven by it; a file a package.json script names is a
    // runnable entry point.
    const testText = tests.map(hunkText).join('\n').toLowerCase();
    const pkgText = hunks
      .filter((h) => /(^|\/)package\.json$/.test(String(h.file)))
      .map(hunkText)
      .join('\n')
      .toLowerCase();
    // A package.json script (`"name": "<runner> … path"`) that runs the file.
    const pkgRuns = (f: string) =>
      pkgText
        .split('\n')
        .some(
          (l) =>
            /^[+-]?\s*["'][\w:.-]+["']\s*:\s*["']/.test(l) &&
            new RegExp(
              String.raw`\b(?:bun|node|tsx|ts-node|deno|python3?|sh|bash|pwsh|npx|bunx)\b[^"']*?(?:^|[\s/"'.])${f.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`,
            ).test(l),
        );
    const stem = (f: string) => base(f).replace(/\.[^.]+$/, '');
    const entry = (h: Row, f: string) =>
      SCRIPT_FILE.test(f) || h.shebang === true || (CODE_SCRIPT.test(f) && pkgRuns(f));
    const entries = new Set(
      hunks.filter((h) => entry(h, String(h.file))).map((h) => String(h.file)),
    );
    // A CI result the logs show for a workflow whose steps run the script
    // (results naming no workflow are all of them) is a run of it.
    const ciRanScript = (f: string) =>
      (ciCallers.get(f) ?? []).some(
        (w) =>
          ciSeen ||
          ci.some((x) =>
            (x.workflows ?? []).some((y) => y.toLowerCase() === w.toLowerCase()),
          ),
      );
    for (const h of hunks) {
      const f = String(h.file);
      if (role(f) === 'tests') continue;
      const ch = String(h.change ?? '');
      if (WORKFLOW_FILE.test(f)) workflows.set(f, [...(workflows.get(f) ?? []), ch]);
      else if (
        entries.has(f) &&
        !ciRanScript(f) &&
        !said.includes(base(f)) &&
        !said.includes(stem(f)) &&
        !(stem(f).length >= 4 && testText.includes(stem(f)))
      )
        scripts.set(f, [...(scripts.get(f) ?? []), ch]);
    }
    if (scripts.size) {
      const files = [...scripts.keys()].sort();
      out.push({
        change: scripts.get(files[0]!)![0] || null,
        kind: 'open',
        limit: `${shown(files)} ${files.length === 1 ? 'is a changed script' : 'are changed scripts'} no recorded session command ran; only the diff shows ${files.length === 1 ? 'it' : 'them'}.`,
      });
    }
    // CI results in the logs (for any commit of the PR) that name no workflow
    // are runs of them all. A run of a named workflow file (`gh workflow run
    // release.yml`, then `gh run watch`) is a run of that file: before its
    // last edit, the row says so.
    if (workflows.size && !ciSeen) {
      const runsOf = (f: string) =>
        ci.filter((x) => (x.workflows ?? []).some((w) => w.toLowerCase() === wfBase(f)));
      const editedAt = (f: string) => lastEdit.get(f);
      const unrun = [...workflows.keys()].filter((f) => !runsOf(f).length).sort();
      const stale = [...workflows.keys()]
        .filter((f) => {
          const rs = runsOf(f);
          const e = editedAt(f);
          return rs.length > 0 && !!e && rs.every((x) => x.t < e);
        })
        .sort();
      for (const f of stale)
        out.push({
          change: workflows.get(f)![0] || null,
          kind: 'open',
          limit: `a CI run of ${f} came before its last edit; none after, so no recorded run shows the final ${wfBase(f)}.`,
        });
      if (unrun.length)
        out.push({
          change: workflows.get(unrun[0]!)![0] || null,
          kind: 'open',
          limit: `${shown(unrun)} change${unrun.length === 1 ? 's' : ''} CI workflow${unrun.length === 1 ? '' : 's'}; workflows run in CI, and no run of ${unrun.length === 1 ? 'it' : 'them'} is in the session logs${
            stale.length || ci.some((x) => (x.workflows ?? []).length)
              ? ' (the CI runs recorded ran other workflows)'
              : ''
          }.`,
        });
    }
  }
  // Behavior the changed tests reach only through fakes or stubs, named as
  // the tests name them ("a fake release server").
  const faked = new Map<string, Set<string>>();
  const doubles = new Set<string>();
  const phrases = new Set<string>();
  const files = new Set<string>();
  // A server the tests start on this machine stands in for the remote end
  // only: the code under test makes its real calls to it (a real path).
  const localServer = tests.some((h) => h.localServer === true);
  for (const h of tests) {
    const lines = ((h.code as string[]) ?? []).map(String).filter((l) => FAKE.test(l));
    const named = ((h.fakes as string[]) ?? []).map(String);
    if (!lines.length && !named.length) continue;
    files.add(String(h.file));
    named.forEach((x) => phrases.add(x));
    for (const [what, re] of FAKED_STEP)
      if ([...lines, ...named].some((l) => re.test(l)))
        faked.set(what, new Set([...(faked.get(what) ?? []), String(h.file)]));
    for (const l of lines)
      for (const m of l.matchAll(FAKE_NAME)) {
        const n = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').split('/').pop()!;
        if (n.length >= 4) doubles.add(n);
      }
  }
  for (const h of hunks)
    if (role(String(h.file)) !== 'tests' && DOUBLE_FILE.test(String(h.file)))
      doubles.add(String(h.file).split('/').pop()!);
  const NETWORK = FAKED_STEP[0]![1];
  if (localServer) {
    faked.delete(FAKED_STEP[0]![0]);
    for (const x of [...phrases]) if (NETWORK.test(x)) phrases.delete(x);
  }
  // The change units whose code the doubles stand in for, by name.
  const doubleStem = (n: string) =>
    n
      .replace(/\.[^.]+$/, '')
      .replace(/^(?:mock|stub|fake)[-_]?|[-_]?(?:mock|stub|fake)$/i, '')
      .toLowerCase();
  const stems = [...doubles].map(doubleStem).filter((x) => x.length >= 3);
  const reached = src
    .filter((h) => !DOUBLE_FILE.test(String(h.file)))
    .filter((h) =>
      stems.some(
        (x) =>
          String(h.file).toLowerCase().includes(x) ||
          ((h.symbols as string[]) ?? []).some((s) => String(s).toLowerCase() === x),
      ),
    );
  const fakeUnits = [
    ...new Set(reached.map((h) => String(h.change ?? '')).filter(Boolean)),
  ].sort();
  // A recorded command that ran that code for real answers the row.
  const ranForReal =
    !!live && reached.some((h) => reachingRuns(String(h.file), live).length > 0);
  // Every fake was the local server's stand-in: nothing faked is left.
  const onlyServer = localServer && !faked.size && !phrases.size;
  if (files.size && !ranForReal && !onlyServer) {
    const fs = [...files].sort();
    const what = [...faked.keys()];
    const names = [...doubles]
      .sort()
      .slice(0, 3)
      .map((n) => `\`${n}\``);
    // Name the specific fake: the tests' own words, else the double's name.
    const fromName = (n: string) => {
      const ws = splitName(
        n
          .replace(/\.[^.]+$/, '')
          .replace(/^(?:mock|stub|fake)[-_]?|[-_]?(?:mock|stub|fake)$/i, ''),
      )
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !/^(?:mock|stub|fake)$/.test(w));
      return ws.length ? `fake ${ws.join(' ')}` : '';
    };
    const specific = [
      ...new Set([
        ...phrases,
        ...(phrases.size ? [] : [...doubles].sort().map(fromName).filter(Boolean)),
      ]),
    ].slice(0, 2);
    const reachedBy = fakeUnits.length
      ? `; ${fakeUnits.join(', ')} ${fakeUnits.length === 1 ? 'is' : 'are'} reached that way`
      : '';
    const shownNames = names.length ? ` (${names.join(', ')})` : '';
    out.push({
      change: fakeUnits[0] ?? null,
      kind: 'open',
      limit: specific.length
        ? `The changed tests (${shown(fs)}) use ${joinNames(specific.map((x) => `a ${x}`))}${shownNames}${reachedBy}: they check the code around ${specific.length > 1 ? 'them' : 'it'}, not the real ${joinNames(specific.map((x) => x.replace(/^\S+\s+/, '')))}.`
        : `The changed tests (${shown(fs)}) replace ${what.length ? what.join(', ') : 'collaborators'} with fakes or stubs${shownNames}${reachedBy}: they check the logic around those steps, not the real ${what.length === 1 ? 'step' : 'steps'}.`,
    });
  }
  // Only real terminal code in shipped (non-prose) files: a TTY test, raw
  // mode, termios, a pseudo-terminal; never prompt or instruction text.
  const tty = src.filter(
    (h) =>
      !/\.(?:md|mdx|rst|txt|adoc|json|ya?ml|toml)$/i.test(String(h.file)) &&
      ttyCodeLines(addedLines(h)).length > 0,
  );
  if (tty.length) {
    const files = [...new Set(tty.map((h) => String(h.file)))].sort();
    out.push({
      change: String(tty[0]!.change ?? '') || null,
      kind: 'open',
      limit: `${files.slice(0, 3).join(', ')} change${files.length === 1 ? 's' : ''} interactive (terminal/TTY) handling; recorded checks run without a terminal, so none shows that path with a user at the keyboard.`,
    });
  }
  return out;
}

const clipLine = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Every command text the included sessions ran (checks, others, failures); undefined with none. */
export function sessionCommands(g: GraphEngine): string[] | undefined {
  const sessions = g.run(
    `MATCH (s:Session {band: 'included'})
       RETURN s.invoked AS invoked, s.lateCmds AS late, s.failedCmds AS failed`,
  ).rows;
  if (!sessions.length) return undefined;
  return [
    ...sessions.flatMap((s) =>
      [s.invoked, s.late, s.failed].flatMap((x) => ((x as string[]) ?? []).map(String)),
    ),
    ...g
      .run(
        `MATCH (r:Run)-[:IN_SESSION]->(:Session {band: 'included'}) RETURN r.cmd AS cmd`,
      )
      .rows.map((r) => String(r.cmd ?? '')),
  ];
}

/**
 * A remote CI run of the included sessions: platforms its jobs passed on
 * (`os`) or finished on (`ran`), the workflow files it ran (`workflows`),
 * when it was looked at and whether the look failed (`gh run watch
 * --exit-status`).
 */
export type CiRun = {
  os: string[];
  ran?: string[];
  workflows?: string[];
  t: string;
  failed?: boolean;
};

/**
 * CI looks of the included sessions that showed jobs on a runner platform or
 * results of a named workflow, with when; and each PR file's last captured
 * edit.
 */
export function ciPlatformRuns(g: GraphEngine): {
  ci: CiRun[];
  lastEdit: Map<string, string>;
} {
  const words = (xs: unknown, i: number) =>
    String(((xs as string[]) ?? [])[i] ?? '')
      .split(' ')
      .filter(Boolean);
  const ci = g
    .run(
      `MATCH (s:Session {band: 'included'})
       RETURN s.remoteKinds AS kinds, s.remoteT AS ts, s.remoteFailed AS failed, s.remoteOs AS os,
              s.remoteRanOs AS ran, s.remoteWorkflows AS workflows, s.remoteResults AS results`,
    )
    .rows.flatMap((r) =>
      ((r.kinds as string[]) ?? []).flatMap((k, i): CiRun[] => {
        const failed = ((r.failed as string[]) ?? [])[i] === 'failed';
        // Jobs shown passing passed, whatever the look's exit status (`gh pr
        // checks` exits non-zero when any other check fails).
        const os = words(r.os, i);
        const ran = words(r.ran, i);
        const results = words(r.results, i)[0] === 'results';
        // A named workflow counts only from a look that shows its result.
        const workflows = results ? words(r.workflows, i) : [];
        const t = String(((r.ts as string[]) ?? [])[i] ?? '');
        return k === 'ci' && t && (os.length || ran.length || workflows.length)
          ? [{ os, ran, workflows, t, failed }]
          : [];
      }),
    );
  const lastEdit = new Map<string, string>();
  for (const r of g.run(
    `MATCH (e:Edit)-[:IN_SESSION]->(:Session {band: 'included'}) RETURN e.file AS file, e.t AS t`,
  ).rows) {
    const f = String(r.file ?? '');
    const t = String(r.t ?? '');
    if (f && t && t > (lastEdit.get(f) ?? '')) lastEdit.set(f, t);
  }
  return { ci, lastEdit };
}

/** Pushes, PRs made and CI looks of the included sessions, oldest first. */
function remoteEvents(g: GraphEngine) {
  return g
    .run(
      `MATCH (s:Session {band: 'included'})
       RETURN s.remoteCmds AS cmds, s.remoteKinds AS kinds, s.remoteT AS ts, s.remoteFailed AS failed,
              s.remoteResults AS results, s.remoteWorkflows AS workflows, s.remoteWith AS pushedWith`,
    )
    .rows.flatMap((r) =>
      ((r.cmds as string[]) ?? []).map((c, i) => {
        const res = String(((r.results as string[]) ?? [])[i] ?? '')
          .split(' ')
          .filter(Boolean);
        return {
          cmd: String(c),
          kind: String(((r.kinds as string[]) ?? [])[i] ?? ''),
          t: String(((r.ts as string[]) ?? [])[i] ?? ''),
          failed: ((r.failed as string[]) ?? [])[i] === 'failed',
          results: res[0] === 'results',
          heads: res.slice(1),
          workflows: String(((r.workflows as string[]) ?? [])[i] ?? '')
            .split(' ')
            .filter(Boolean),
          withCommit: ((r.pushedWith as string[]) ?? [])[i] === 'commit',
        };
      }),
    )
    .sort((a, b) => a.t.localeCompare(b.t));
}

/** This PR's commits with a time, newest first. */
const prCommits = (g: GraphEngine) =>
  g
    .run('MATCH (k:Commit) WHERE k.t IS NOT NULL RETURN k.id AS id, k.t AS t')
    .rows.sort((a, b) => String(b.t).localeCompare(String(a.t)));

/**
 * CI looks whose output shows check results (pass/fail) for this PR: made at
 * or after its first commit, or naming one of its commits.
 */
function ciResultLooks(g: GraphEngine) {
  const commits = prCommits(g);
  const first = commits.at(-1);
  const ids = commits.map((k) => shortSha(k.id));
  return remoteEvents(g).filter(
    (x) =>
      x.kind === 'ci' &&
      x.results &&
      (x.heads.some((h) => ids.includes(h)) || !first || !x.t || x.t >= String(first.t)),
  );
}

/** Whether the logs record CI or check results for any commit of this PR. */
export const ciResultsSeen = (g: GraphEngine): boolean =>
  // A look at one named workflow's run is a run of that file only (see
  // environmentRows), not of every workflow.
  ciResultLooks(g).some((x) => !x.workflows.length);

/** What a publishing command did, in words. */
const publishVerb = (cmd: string) =>
  /^gh pr create/.test(cmd)
    ? 'opened a PR'
    : /^gh pr ready/.test(cmd)
      ? 'marked the PR ready for review'
      : /^gh pr merge/.test(cmd)
        ? 'merged the PR'
        : 'pushed';

/**
 * CI on the final head is not in the logs: only when an included session
 * pushed or opened a PR (`git push`, `gh pr create` that didn't fail), worded
 * after what ran. No push means no CI could exist for this head yet (the
 * session was asked not to push, or works locally), and with no session
 * matched there is nothing to pair it with. CI looks whose output shows check
 * results answer it when they cover the final head (they name it, or came
 * after the last push and the last commit); when they cover only an earlier
 * commit the row says so. Otherwise names the CI commands run after the last
 * push, if any.
 */
export function finalHeadRow(g: GraphEngine): Row | null {
  const remote = remoteEvents(g);
  const commits = prCommits(g);
  const last = commits[0];
  const first = commits.at(-1);
  // A push before this PR's first commit pushed earlier work (a shared session).
  const pushes = remote.filter(
    (x) =>
      x.kind === 'publish' && !x.failed && (!first || !x.t || x.t >= String(first.t)),
  );
  if (!pushes.length) return null;
  const lastPush = pushes.at(-1)!;
  // A push whose command line committed first (`git commit …; git push`)
  // pushed that commit: one commit after it, made with it, is not "after".
  const after = commits.filter((k) => !!lastPush.t && String(k.t) > lastPush.t);
  const commitAfter =
    !!last &&
    !!lastPush.t &&
    String(last.t) > lastPush.t &&
    !(
      lastPush.withCommit &&
      after.length === 1 &&
      Date.parse(String(last.t)) - Date.parse(lastPush.t) < 15 * 60_000
    );
  const verbs = [...new Set(pushes.map((x) => publishVerb(x.cmd)))];
  const did = `The session ${joinNames(verbs)} (${[...new Set(pushes.map((x) => `\`${x.cmd}\``))].join(', ')})`;
  const lastId = last ? shortSha(last.id) : '';
  const looks = ciResultLooks(g);
  const onHead = looks.filter((x) =>
    x.heads.length
      ? x.heads.includes(lastId)
      : !commitAfter && !!x.t && x.t >= lastPush.t,
  );
  if (onHead.length) return null;
  if (looks.length) {
    const named = [
      ...new Set(
        looks
          .flatMap((x) => x.heads)
          .filter((h) => commits.some((k) => shortSha(k.id) === h)),
      ),
    ];
    // Looks at the PR's own checks first; runs of one named workflow after.
    const cmds = [
      ...new Set(
        [...looks]
          .sort((a, b) => Number(a.workflows.length > 0) - Number(b.workflows.length > 0))
          .map((x) => `\`${x.cmd}\``),
      ),
    ]
      .slice(0, 3)
      .join(', ');
    return {
      change: null,
      kind: 'open',
      limit: `${did}; the logs record CI results (${cmds}) for an earlier commit of this PR${
        named.length ? ` (${named.join(', ')})` : ''
      }, not for the final head${lastId ? ` (${lastId})` : ''}.`,
    };
  }
  const ci = remote.filter((x) => x.kind === 'ci' && x.t >= lastPush.t);
  const ciCmds = [
    ...new Map(ci.map((x) => [`${x.cmd}${x.failed ? ' (failed)' : ''}`, x])).keys(),
  ];
  return {
    change: null,
    kind: 'open',
    limit: `${did}${
      commitAfter ? `; the last commit (${lastId}) came after the last push` : ''
    }; CI results for the final head are not in the session logs${
      ciCmds.length
        ? ` (afterwards it ran ${ciCmds
            .slice(0, 3)
            .map(
              (c) =>
                `\`${c.replace(' (failed)', '')}\`${c.endsWith('(failed)') ? ', which failed' : ''}`,
            )
            .join('; ')}; its output shows no check results)`
        : ''
    }.`,
  };
}

/** Added code of a hunk's `code` lines: `+ x`, or the new side of `- a ⇒ + b`. */
const addedCode = (code: unknown) =>
  ((code as string[]) ?? [])
    .map(String)
    .map((l) => (l.includes('⇒') ? l.split('⇒').pop()!.trim() : l))
    .filter((l) => l.startsWith('+ '))
    .map((l) => l.slice(2))
    .join('\n');

const NAME = /^[A-Za-z_$][\w$]{2,}$/;
/** A function or value name: starts lowercase, not ALL_CAPS. */
const CALLABLE = /^[a-z_$][\w$]*[a-z][\w$]*$/;
const uniqStr = (xs: string[]) => [...new Set(xs)];
const MIN_CALLS = 2;
/** Callbacks, event handlers and setters by name: `onRunCreated`, `handleClick`, `setName`. */
const CALLBACK_NAME = /^(?:on|handle|set)[A-Z]/;

/**
 * A hunk's changed code lines per function that owns them (`fnLines`), empty
 * for a graph built before they were counted.
 */
export function linesIn(h: Row): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of ((h.fnLines as string[]) ?? []).map(String)) {
    const i = e.lastIndexOf(': ');
    if (i > 0) m.set(e.slice(0, i), Number(e.slice(i + 2)) || 0);
  }
  return m;
}
/** Names the hunk shows defined as types (class, interface, struct…). */
const typesIn = (h: Row) => ((h.types as string[]) ?? []).map(String);

/** Commit-message rows and their `→ H#` links (structural and search), for ownership. */
export interface SentenceLinks {
  sentences: { ref: string; text: string }[];
  links: Record<string, string[]>;
}

/**
 * What the graph ties to one changed function: the commit sentences linked to
 * a hunk only it owns (the one function the hunk defines, or the only one it
 * touches) or naming it outright, and the added branches of those hunks.
 * `words` (stemmed) is everything said about it, for matching prose.
 */
export interface FnProfile {
  name: string;
  file: string;
  sentences: { ref: string; text: string }[];
  conds: string[];
  /** Stemmed words of the name. */
  nameWords: string[];
  /** Stemmed words of its sentences, its own hunks' words and its branches. */
  words: string[];
}

const fnNames = (h: Row) =>
  uniqStr(
    [h.scope, ...((h.touched as string[]) ?? []), ...((h.symbols as string[]) ?? [])]
      .filter((x): x is string => typeof x === 'string')
      .filter(
        (x) =>
          NAME.test(x) && CALLABLE.test(x) && x.length >= 4 && !typesIn(h).includes(x),
      ),
  );
/**
 * The one function a hunk belongs to, when it is clear: the function holding
 * most of its changed code lines, at least twice any other's (a setter or a
 * predicate the hunk also adds is not where its behavior lives). For a graph
 * without line counts: the one it defines, or the one it touches.
 */
const soleOf = (h: Row): string | undefined => {
  const lines = [...linesIn(h)]
    .filter(([n]) => NAME.test(n) && CALLABLE.test(n) && n.length >= 4)
    .filter(([n]) => !typesIn(h).includes(n))
    .sort((a, b) => b[1] - a[1]);
  if (lines.length)
    return lines.length === 1 || lines[0]![1] >= 2 * lines[1]![1]
      ? lines[0]![0]
      : undefined;
  const defined = ((h.symbols as string[]) ?? [])
    .map(String)
    .filter((x) => NAME.test(x) && CALLABLE.test(x) && x.length >= 4);
  if (defined.length === 1) return defined[0];
  if (defined.length) return undefined;
  const all = fnNames(h);
  return all.length === 1 ? all[0] : undefined;
};
const nameWordsOf = (name: string) =>
  [...wordsOf(name)].filter((w) => !HANDLER_WORD.has(w));

/** Per changed source function, what the graph ties to it (see `FnProfile`). */
export function functionProfiles(
  g: GraphEngine,
  ctx?: SentenceLinks,
): Map<string, FnProfile> {
  const hunks = g
    .run(
      `MATCH (h:Hunk)-[:OF]->(f:File)
       RETURN h.id AS id, h.file AS file, f.role AS role, h.scope AS scope, h.touched AS touched,
              h.symbols AS symbols, h.conds AS conds, h.words AS words,
              h.fnLines AS fnLines, h.types AS types`,
    )
    .rows.filter((h) => unitRole(String(h.file), String(h.role ?? '')) === 'src')
    .sort((a, b) => Number(String(a.id).slice(1)) - Number(String(b.id).slice(1)));
  const out = new Map<string, FnProfile>();
  const sole = new Map<string, Row[]>();
  for (const h of hunks) {
    for (const n of fnNames(h))
      if (!out.has(n))
        out.set(n, {
          name: n,
          file: String(h.file),
          sentences: [],
          conds: [],
          nameWords: nameWordsOf(n),
          words: [],
        });
    const one = soleOf(h);
    if (one) {
      sole.set(one, [...(sole.get(one) ?? []), h]);
      // soleOf can pick a name only `fnLines` lists (not scope/touched/symbols).
      const p = out.get(one);
      if (p) p.file = String(h.file);
      else
        out.set(one, {
          name: one,
          file: String(h.file),
          sentences: [],
          conds: [],
          nameWords: nameWordsOf(one),
          words: [],
        });
    }
  }
  const sentences = ctx?.sentences ?? [];
  const linkCount = (ref: string) => (ctx?.links[ref] ?? []).length || 99;
  for (const p of out.values()) {
    const own = sole.get(p.name) ?? [];
    const ownIds = new Set(own.map((h) => String(h.id)));
    const esc = p.name.replace(/[$]/g, '\\$');
    p.sentences = sentences
      .filter((x) => {
        if ((ctx?.links[x.ref] ?? []).some((id) => ownIds.has(id))) return true;
        if (new RegExp(`\`${esc}\``).test(x.text)) return true;
        const ws = wordsOf(x.text);
        return p.nameWords.length >= 2 && p.nameWords.every((w) => ws.has(w));
      })
      .sort((a, b) => linkCount(a.ref) - linkCount(b.ref));
    p.conds = uniqStr(
      own
        .flatMap((h) => ((h.conds as string[]) ?? []).map(String))
        .filter((c) => c.startsWith('+ '))
        .map((c) => c.slice(2).trim()),
    );
    p.words = [
      ...new Set([
        ...p.sentences.flatMap((x) => [...wordsOf(x.text)]),
        ...own.flatMap((h) => [...wordsOf(((h.words as string[]) ?? []).join(' '))]),
        ...p.conds.flatMap((c) => [...wordsOf(c)]),
      ]),
    ];
  }
  return out;
}

const clipAt = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n * 0.6)).replace(/[\s,;:]+$/, '')}…`;
};
/** What the graph ties to a function, short: its most specific sentence, else its longest added branch. */
function ownedBy(
  p: FnProfile | undefined,
  n: number,
): { text: string; cite?: string } | undefined {
  if (!p) return undefined;
  const s = p.sentences[0];
  if (s) return { text: `${clipAt(s.text, n)} (${s.ref})`, cite: s.ref };
  const c = [...p.conds].sort((a, b) => b.length - a.length)[0];
  return c ? { text: `\`${clipAt(c, n - 6).replace(/`/g, "'")}\`` } : undefined;
}

/** Above this the entry row stops adding functions. */
const ENTRY_CHARS = 300;

/**
 * Where a reviewer starts: the changed function in a shipped source file
 * (not a test or script) whose new lines call the most changed symbols of
 * other files (it owns the behavior they implement), named with its file. A hunk belongs to the function git names after its @@
 * (the one it starts in), else the first it touches. Needs MIN_CALLS distinct
 * calls; otherwise the most-referenced changed symbol from the head scan,
 * if a source file defines it and it owns at least MIN_ENTRY_SHARE of the
 * added source lines (a small helper many files call is not where the
 * behavior lives). Undefined when neither holds.
 *
 * The row also says what each function owns (`functionProfiles`): what the
 * graph ties to the entry, then its changed callees, the next function in its
 * file and its changed callers, each with what is tied to it, so a writer
 * doesn't pin a caller's or callee's behavior on the entry.
 */
export function entryRow(g: GraphEngine, ctx?: SentenceLinks): Row | undefined {
  const hunks = g
    .run(
      `MATCH (c:Change)-[:HAS]->(h:Hunk)-[:OF]->(f:File)
       RETURN c.id AS change, h.id AS id, h.file AS file, f.role AS role, h.scope AS scope,
              h.touched AS touched, h.fresh AS fresh, h.symbols AS symbols, h.code AS code,
              h.diff AS diff, h.branches AS branches, h.added AS added,
              h.owns AS owns, h.readers AS readers, h.fnLines AS fnLines, h.types AS types,
              h.thin AS thin`,
    )
    .rows.filter((h) => unitRole(String(h.file), String(h.role ?? '')) === 'src')
    .sort((a, b) => Number(String(a.id).slice(1)) - Number(String(b.id).slice(1)));
  if (!hunks.length) return undefined;
  const { owning, ownsIn } = changeOwners(hunks);
  // Setters and callbacks (a whole body of one assignment or call-through)
  // are never the entry, nor named beside it.
  const thinFn = new Set(hunks.flatMap((h) => ((h.thin as string[]) ?? []).map(String)));
  const linesOfFn = new Map<string, number>();
  for (const h of hunks)
    for (const [n, k] of linesIn(h)) linesOfFn.set(n, (linesOfFn.get(n) ?? 0) + k);
  /** The owners rows' thin-helper rule: few changed lines next to an entry with several times as many. */
  const thinBeside = (name: string, entry: string) => {
    if (thinFn.has(name)) return true;
    const mine = linesOfFn.get(name);
    const theirs = linesOfFn.get(entry);
    return (
      mine != null &&
      theirs != null &&
      mine <= THIN_LINES &&
      theirs >= THIN_RATIO * Math.max(mine, 1)
    );
  };
  // A start point is a function defined in the file the row names: never a
  // type, an interface or a name the file only imports.
  const typed = hunks.some((h) => Array.isArray(h.types));
  const types = new Set(
    hunks.flatMap((h) => typesIn(h).map((n) => `${String(h.file)}#${n}`)),
  );
  const anyType = new Set(hunks.flatMap(typesIn));
  const definedHere = (name: string, file: string) =>
    hunks.some(
      (h) =>
        String(h.file) === file &&
        [h.scope, ...((h.symbols as string[]) ?? []), ...((h.touched as string[]) ?? [])]
          .map((x) => (x == null ? '' : String(x)))
          .includes(name),
    );
  const fnLike = (name: string, file: string) =>
    !types.has(`${file}#${name}`) && (typed || CALLABLE.test(name));
  const definedIn = new Map<string, string>();
  for (const h of hunks)
    for (const s of [
      ...((h.symbols as string[]) ?? []),
      ...((h.fresh as string[]) ?? []),
      ...((h.touched as string[]) ?? []),
    ])
      if (NAME.test(String(s)) && String(s).length >= 4 && !definedIn.has(String(s)))
        definedIn.set(String(s), String(h.file));
  const refsOf = new Map(
    g
      .run(
        `MATCH (x:HeadRef) WHERE x.kind <> 'still mentions' AND x.kind <> 'test scan' RETURN x.term AS term, x.files AS files, x.kind AS kind, x.definedIn AS definedIn`,
      )
      .rows.map((r) => [String(r.term), r]),
  );
  type Owner = {
    name: string;
    file: string;
    change: string;
    calls: Set<string>;
    diff: string[];
    branches: number;
  };
  const owners = new Map<string, Owner>();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const h of hunks) {
    // The function that owns the hunk's changed code: never one git only names
    // after the @@ while the changes sit below it, one whose lines only moved,
    // or a getter that only reads a value.
    // Of those, the one holding most of the hunk's changed lines (a setter or
    // predicate named first is not where the behavior lives); a type never.
    const lines = linesIn(h);
    const owner = uniqStr(
      [h.scope, ...((h.touched as string[]) ?? []), ...(ownsIn(h) ?? [])]
        .map((x) => (x == null ? '' : String(x)))
        .filter(
          (x) =>
            NAME.test(x) &&
            !thinFn.has(x) &&
            (!ownsIn(h) || ownsIn(h)!.includes(x)) &&
            fnLike(x, String(h.file)),
        ),
    ).sort((a, b) => (lines.get(b) ?? 0) - (lines.get(a) ?? 0))[0];
    if (!owner) continue;
    const code = addedCode(h.code);
    const key = `${String(h.file)}#${owner}`;
    const o = owners.get(key) ?? {
      name: owner,
      file: String(h.file),
      change: String(h.change),
      calls: new Set<string>(),
      diff: [],
      branches: 0,
    };
    // Calls into other files' changed code: the function that wires the
    // change together, not a helper calling its neighbours.
    // Functions and values only: a type (`ProviderId`) or constant is not a call.
    for (const [name, file] of definedIn)
      if (
        name !== owner &&
        file !== String(h.file) &&
        CALLABLE.test(name) &&
        new RegExp(`\\b${esc(name)}\\s*[(),\\]]`).test(code)
      )
        o.calls.add(name);
    o.diff.push(String(h.diff));
    o.branches += Number(h.branches ?? 0);
    owners.set(key, o);
  }
  const profiles = functionProfiles(g, ctx);
  const fileOf = (n: string) => profiles.get(n)?.file ?? definedIn.get(n);
  /** The entry's own clause, then one clause per related function while the row stays short. */
  const compose = (
    entry: string,
    entryFile: string,
    lead: string,
    related: { name: string; how: string }[],
  ) => {
    const cites: string[] = [];
    const mine = ownedBy(profiles.get(entry), 64);
    if (mine?.cite) cites.push(mine.cite);
    let text = `Start at \`${entry}\` in ${entryFile}${lead}${mine ? `; tied to it: ${mine.text}` : ''}.`;
    const head = ` Not in \`${entry}\`: `;
    const parts: string[] = [];
    for (const r of related) {
      // Only functions that own changed code are named (see `changeOwners`).
      if (!owning(r.name) || anyType.has(r.name)) continue;
      if (thinBeside(r.name, entry)) continue;
      const what = ownedBy(profiles.get(r.name), 48);
      // A callee the lead already names adds something only with what is tied to it.
      if (r.how === 'called' && !what) continue;
      const file = fileOf(r.name);
      const where = file === entryFile ? 'same file' : (file ?? '');
      // Call relations are matched from hunk text, not a real call graph, so they
      // are never printed: only where a function lives and what is tied to it.
      if (!what) continue;
      const part = `\`${r.name}\`${where ? ` (${where})` : ''}: ${what.text}`;
      if (
        text.length + head.length + [...parts, part].join('; ').length > ENTRY_CHARS &&
        parts.length
      )
        break;
      parts.push(part);
      if (what?.cite) cites.push(what.cite);
    }
    if (parts.length) text += `${head}${parts.join('; ')}.`;
    return { text, cites };
  };
  const callersOf = (name: string) =>
    [...owners.values()]
      .filter((o) => o.name !== name && o.calls.has(name))
      .sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
  const refFiles = (n: string) => Number(refsOf.get(n)?.files ?? 0);
  // A callback, handler or setter is never where the decision lives, nor a
  // thin wrapper: the function holding the most changed lines with branches is.
  const handler = (o: Owner) => CALLBACK_NAME.test(o.name) || thinFn.has(o.name);
  const ranked = [...owners.values()]
    .filter((o) => o.calls.size >= MIN_CALLS)
    .filter((o) => !handler(o))
    .sort(
      (a, b) =>
        b.calls.size - a.calls.size ||
        refFiles(b.name) - refFiles(a.name) ||
        b.branches - a.branches ||
        (linesOfFn.get(b.name) ?? 0) - (linesOfFn.get(a.name) ?? 0) ||
        a.file.localeCompare(b.file) ||
        a.name.localeCompare(b.name),
    );
  const best = ranked[0];
  if (best) {
    // The next owner in the same file, often the one choosing between paths.
    const next = ranked.find((o) => o !== best && o.file === best.file);
    const called = [...best.calls].sort();
    const elsewhere = [
      ...new Set(called.map((c) => definedIn.get(c)!).filter((f) => f !== best.file)),
    ];
    // `called`/`elsewhere` only rank the entry; call claims are not printed.
    void elsewhere;
    const lead = '';
    const related = [
      ...(next
        ? [
            {
              name: next.name,
              how: `calls ${[...next.calls]
                .sort()
                .slice(0, 3)
                .map((c) => `\`${c}\``)
                .join(', ')}`,
            },
          ]
        : []),
      ...called.map((c) => ({ name: c, how: 'called' })), // already in the lead
      ...callersOf(best.name).map((o) => ({
        name: o.name,
        how: `calls \`${best.name}\``,
      })),
    ].filter(
      (r, i, all) =>
        r.name !== best.name && all.findIndex((x) => x.name === r.name) === i,
    );
    const { text, cites } = compose(best.name, best.file, lead, related);
    return {
      kind: 'entry',
      fact: text,
      cites: uniqStr([
        best.change,
        ...best.diff.slice(0, 2),
        ...(next ? [next.change, next.diff[0]!] : []),
        ...cites,
      ]),
    };
  }
  // Otherwise the most-referenced changed symbol, only when it owns a real
  // share of the added source lines: a small helper many files call is not
  // where the behavior lives, and then there is no entry row.
  const top = [...refsOf.values()].find((r) => r.kind === 'most referenced');
  const file = top ? ((top.definedIn as string[]) ?? []).map(String)[0] : undefined;
  if (!top || !file || unitRole(file, pathRole(file)) !== 'src') return undefined;
  const named = String(top.term);
  if (!owning(named)) return undefined;
  if (ownedShare(hunks, named, file) < MIN_ENTRY_SHARE) return undefined;
  const h = hunks.find((x) => x.file === file);
  const where = h ? [String(h.change), String(h.diff)] : [];
  // A type, or a name the file doesn't define: the function there that owns
  // the most added lines instead, else the file alone.
  const term =
    definedHere(named, file) &&
    fnLike(named, file) &&
    !thinFn.has(named) &&
    !CALLBACK_NAME.test(named)
      ? named
      : uniqStr(
          hunks
            .filter((x) => String(x.file) === file)
            .flatMap((x) => [
              x.scope,
              ...((x.symbols as string[]) ?? []),
              ...((x.touched as string[]) ?? []),
            ])
            .map((x) => (x == null ? '' : String(x))),
        )
          .filter(
            (n) =>
              NAME.test(n) &&
              owning(n) &&
              fnLike(n, file) &&
              !thinFn.has(n) &&
              !CALLBACK_NAME.test(n),
          )
          .map((n) => ({ n, share: ownedShare(hunks, n, file) }))
          .filter((x) => x.share >= MIN_ENTRY_SHARE)
          .sort((a, b) => b.share - a.share || a.n.localeCompare(b.n))[0]?.n;
  if (!term) return { kind: 'entry', fact: `Start in ${file}.`, cites: where };
  const related = callersOf(term).map((o) => ({
    name: o.name,
    how: `calls \`${term}\``,
  }));
  const { text, cites } = compose(term, file, '', related);
  return {
    kind: 'entry',
    fact: text,
    cites: uniqStr([...where, ...cites]),
  };
}

/**
 * Which functions own changed code, from the hunks' `owns` and `readers`
 * (patchHunks): a function owns a change when a changed code line that was not
 * just moved sits in its body; a getter whose changed code only reads a value
 * owns none. `ownsIn(h)` is a hunk's owners, undefined for a graph built
 * before `owns` existed (then every function counts, as before).
 */
export function changeOwners(hunks: Row[]): {
  owning: (name: string) => boolean;
  ownsIn: (h: Row) => string[] | undefined;
} {
  const known = hunks.some((h) => Array.isArray(h.owns));
  const list = (x: unknown) => ((x as string[]) ?? []).map(String);
  // A function owns a change when some hunk's changed code in it does more than read.
  const owners = new Set(
    hunks.flatMap((h) => list(h.owns).filter((n) => !list(h.readers).includes(n))),
  );
  return {
    owning: (name) => !known || owners.has(name),
    ownsIn: (h) => (known ? list(h.owns).filter((n) => owners.has(n)) : undefined),
  };
}

/** The least share of the added source lines a fallback entry symbol must own. */
const MIN_ENTRY_SHARE = 0.2;

/**
 * The share of the added source lines that `name` owns: each hunk in its
 * file that defines it or changes its body, split evenly among the symbols
 * that hunk defines or changes.
 */
function ownedShare(hunks: Row[], name: string, file: string): number {
  let total = 0;
  let own = 0;
  for (const h of hunks) {
    const added = Number(h.added ?? 0);
    total += added;
    if (String(h.file) !== file) continue;
    const names = new Set(
      [...((h.symbols as string[]) ?? []), ...((h.touched as string[]) ?? [])].map(
        String,
      ),
    );
    if (h.scope != null && !names.size) names.add(String(h.scope));
    if (names.has(name)) own += added / names.size;
  }
  return total ? own / total : 0;
}

// --- Where each behavior lives ---------------------------------------------

/** Most `owners` rows, and per change unit. */
export const MAX_OWNER_ROWS = 6;
const OWNERS_PER_CHANGE = 5;
/** Changed code lines at or under which a function is a thin helper for `owners`. */
const THIN_LINES = 3;
/** How many times a thin helper's lines another function must hold to own the clause instead. */
const THIN_RATIO = 3;
/** Characters of a sentence excerpt in an `owners` row. */
const OWNER_TEXT = 80;

/**
 * Where each behavior lives: commit sentences mapped to the one or two changed
 * functions whose changed lines say what the sentence says. A hunk's changed
 * lines are split by the function they sit in (`fnWords`, with a doc comment
 * going to the definition below it), so a hunk that defines several functions
 * still tells them apart. A sentence linked to hunks (`→ H#`) is matched only
 * against the functions in those hunks; an unlinked one against every changed
 * source function, with a higher bar. Kept only when one or two functions
 * clearly lead (high precision), and only in change units where at least two
 * distinct functions own different sentences: that is where a writer pins one
 * function's behavior on its neighbour. Never says who calls whom.
 */
/** A sentence's clauses: split at `;`, and at `: ` when both sides say something. */
export function clausesOf(text: string): string[] {
  const words = (x: string) => x.trim().split(/\s+/).filter(Boolean).length;
  const out: string[] = [];
  for (const part of text.split(/;\s+/)) {
    const i = part.indexOf(': ');
    if (i > 0 && words(part.slice(0, i)) >= 3 && words(part.slice(i + 2)) >= 3)
      out.push(part.slice(0, i), part.slice(i + 2));
    else out.push(part);
  }
  return out.map((x) => x.trim().replace(/[.;:,]+$/, '')).filter(Boolean);
}

export function ownerRows(
  g: GraphEngine,
  ctx: SentenceLinks,
  max = MAX_OWNER_ROWS,
): Row[] {
  let hunks: Row[];
  try {
    hunks = g.run(
      `MATCH (c:Change)-[:HAS]->(h:Hunk)-[:OF]->(f:File)
       RETURN c.id AS change, h.id AS id, h.file AS file, f.role AS role, h.diff AS diff,
              h.fnWords AS fnWords, h.owns AS owns, h.fnLines AS fnLines, h.types AS types`,
    ).rows;
  } catch {
    return [];
  }
  type Seg = {
    fn: string;
    file: string;
    change: string;
    hunk: string;
    diff: string;
    words: Set<string>;
    /** Its changed code lines in the hunk, when counted. */
    lines?: number;
  };
  const segs: Seg[] = [];
  for (const h of hunks) {
    if (unitRole(String(h.file), String(h.role ?? '')) !== 'src') continue;
    for (const entry of ((h.fnWords as string[]) ?? []).map(String)) {
      const i = entry.indexOf(': ');
      const fn = i < 0 ? entry : entry.slice(0, i);
      if (!NAME.test(fn) || !CALLABLE.test(fn) || fn.length < 4) continue;
      // A function whose changed lines only moved owns no behavior here.
      if (Array.isArray(h.owns) && !(h.owns as string[]).map(String).includes(fn))
        continue;
      if (typesIn(h).includes(fn)) continue;
      segs.push({
        lines: linesIn(h).get(fn),
        fn,
        file: String(h.file),
        change: String(h.change),
        hunk: String(h.id),
        diff: String(h.diff),
        words: wordsOf(i < 0 ? '' : entry.slice(i + 2)),
      });
    }
  }
  if (!segs.length) return [];
  const byNum = (a: string, b: string) =>
    Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''));
  type Hit = { ref: string; text: string; fns: Seg[][]; change: string; file: string };
  const hits: Hit[] = [];
  for (const s of ctx.sentences) {
    // Sentences, not subjects: a subject sums up what its sentences detail.
    if (!s.ref.includes('#')) continue;
    const linked = new Set(ctx.links[s.ref] ?? []);
    const linkedFiles = new Set(
      segs.filter((x) => linked.has(x.hunk)).map((x) => x.file),
    );
    // Linked: the functions of the linked hunks' files, those hunks first.
    const pool = linked.size ? segs.filter((x) => linkedFiles.has(x.file)) : segs;
    const byFn = new Map<string, Seg[]>();
    for (const x of pool) {
      const key = `${x.file}#${x.fn}`;
      byFn.set(key, [...(byFn.get(key) ?? []), x]);
    }
    // A word most of the pool's functions share tells them apart less.
    const fnSets = [...byFn.values()].map((xs) => ({
      xs,
      words: new Set(xs.flatMap((x) => [...x.words])),
      name: nameWordsOf(xs[0]!.fn),
    }));
    const df = (w: string, of: (f: (typeof fnSets)[number]) => Iterable<string>) =>
      fnSets.filter((f) => [...of(f)].includes(w)).length;
    const done = new Set<string>();
    for (const clause of clausesOf(s.text)) {
      const sw = wordsOf(clause);
      if (sw.size < 3) continue;
      const scored = fnSets
        .map(({ xs, words, name }) => {
          const named = name
            .filter((w) => sw.has(w))
            .reduce((n, w) => n + (df(w, (f) => f.name) > 1 ? 1 : 2), 0);
          const said = [...sw]
            .filter((w) => words.has(w))
            .reduce((n, w) => n + (df(w, (f) => f.words) > 2 ? 0.5 : 1), 0);
          const tied = xs.some((x) => linked.has(x.hunk)) ? 2 : 0;
          return { xs, score: said + named + tied };
        })
        .sort((a, b) => b.score - a.score || a.xs[0]!.fn.localeCompare(b.xs[0]!.fn));
      const top = scored[0];
      if (!top) continue;
      const bar = linked.size ? 3 : 4;
      if (top.score < bar) continue;
      const chosen = scored.filter((x) => x.score >= Math.max(bar, top.score * 0.75));
      if (chosen.length > 2) continue;
      // A clear lead over every other function.
      const rest = scored[chosen.length];
      if (rest && rest.score > top.score * (linked.size ? 0.7 : 0.6)) continue;
      // Both functions in one file, or the row would name two places.
      if (chosen.some((c) => c.xs[0]!.file !== top.xs[0]!.file)) continue;
      // A thin helper (a setter, a predicate) whose words match while a
      // function of the same file holding several times its changed lines also
      // clears the bar: the behavior most likely lives there, so no row.
      const linesOf = (xs: Seg[]) =>
        xs.some((x) => x.lines == null)
          ? undefined
          : xs.reduce((n, x) => n + (x.lines ?? 0), 0);
      const thin = chosen.some((c) => {
        const mine = linesOf(c.xs);
        if (mine == null || mine > THIN_LINES) return false;
        return scored.some(
          (o) =>
            !chosen.includes(o) &&
            o.score >= bar &&
            o.xs[0]!.file === c.xs[0]!.file &&
            (linesOf(o.xs) ?? 0) >= THIN_RATIO * Math.max(mine, 1),
        );
      });
      if (thin) continue;
      const key = chosen.map((c) => c.xs[0]!.fn).join(' ');
      if (done.has(key)) continue;
      done.add(key);
      hits.push({
        ref: s.ref,
        text: clause,
        fns: chosen.map((c) => c.xs),
        change: top.xs[0]!.change,
        file: top.xs[0]!.file,
      });
    }
  }
  // Change units where two or more distinct functions own different sentences.
  const fnsOf = (h: Hit) => h.fns.map((xs) => xs[0]!.fn);
  const confused = new Set(
    [...new Set(hits.map((h) => h.change))].filter((ch) => {
      const own = hits.filter((h) => h.change === ch);
      return own.some((a) =>
        own.some(
          (b) =>
            a !== b &&
            a.file === b.file &&
            fnsOf(a).some((f) => !fnsOf(b).includes(f)) &&
            fnsOf(b).some((f) => !fnsOf(a).includes(f)),
        ),
      );
    }),
  );
  const out: Row[] = [];
  const perChange = new Map<string, number>();
  const seenFn = new Set<string>();
  // One row per function first, so each owner in a unit gets a turn.
  // Units with the most distinct owners first: there a writer mixes them up most.
  const owners = (ch: string) =>
    new Set(hits.filter((h) => h.change === ch).flatMap(fnsOf)).size;
  const ordered = hits
    .filter((h) => confused.has(h.change))
    .sort(
      (a, b) => owners(b.change) - owners(a.change) || a.change.localeCompare(b.change),
    );
  const taken = new Set<string>();
  const take = (h: Hit) => {
    const n = perChange.get(h.change) ?? 0;
    if (taken.has(`${h.ref} ${h.text}`) || n >= OWNERS_PER_CHANGE || out.length >= max)
      return;
    taken.add(`${h.ref} ${h.text}`);
    perChange.set(h.change, n + 1);
    for (const f of fnsOf(h)) seenFn.add(f);
    const diffs = [...new Set(h.fns.flat().map((x) => x.diff))].sort(byNum).slice(0, 2);
    out.push({
      change: h.change,
      behavior: clipAt(h.text, OWNER_TEXT),
      function: fnsOf(h)
        .map((f) => `\`${f}\``)
        .join(' '),
      file: h.file,
      cites: [h.ref, ...diffs].join(' '),
    });
  };
  for (const h of ordered) if (fnsOf(h).some((f) => !seenFn.has(f))) take(h);
  for (const h of ordered) take(h);
  return out.sort(
    (a, b) =>
      String(a.change).localeCompare(String(b.change)) ||
      String(a.file).localeCompare(String(b.file)),
  );
}

/**
 * The session's last check run when it came before the last commit with a
 * captured edit of a PR file in between: which run, and the files edited
 * after it. Undefined when a run saw the last commit's content.
 */
export function lastRunBeforeFinalCommit(
  g: GraphEngine,
  scopedRuns: Row[],
): { id: string; kind: string; files: string[]; commit: string } | undefined {
  const checks = scopedRuns.filter((r) =>
    ['test', 'build', 'lint', 'typecheck'].includes(String(r.kind)),
  );
  const last = prCommits(g)[0];
  if (!last || !checks.length) return undefined;
  const lastRun = [...checks]
    .filter((r) => r.t)
    .sort((a, b) => String(a.t).localeCompare(String(b.t)))
    .at(-1);
  if (!lastRun || String(lastRun.t) > String(last.t)) return undefined;
  const files = editsBetween(g)(String(lastRun.t), String(last.t));
  if (!files.length) return undefined;
  return {
    id: String(lastRun.id),
    kind: String(lastRun.kind),
    files,
    commit: shortSha(last.id),
  };
}
