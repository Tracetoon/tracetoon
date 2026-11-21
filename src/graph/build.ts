/**
 * Build the evidence graph for one run from the redacted full digest, the ordered
 * session trails, the submitted patch and which files each commit touched.
 * Deterministic: the same inputs give byte-identical JSON.
 */
import { evidenceLine } from '../correlate/correlate.ts';
import {
  commandKey,
  fileRole,
  testSegment,
  type SessionTrail,
  type TraceDigest,
} from '../digest/build.ts';
import { clip } from '../digest/sanitize.ts';
import {
  GRAPH_SCHEMA,
  type EvidenceGraph,
  type GraphNode,
  type GraphRel,
  type NodeLabel,
  type Value,
} from './model.ts';

export interface PatchHunk {
  id: string;
  file: string;
  /** New-file line range. */
  start: number;
  end: number;
  added: number;
  removed: number;
  /** One-based changes.patch line range, as change-map evidence cites it. */
  diff: string;
  /** The function or section git printed after the @@ header. */
  context?: string;
  /** The enclosing symbol named in `context`, when one can be read from it. */
  scope?: string;
  /** Functions, classes, methods and types defined on added lines. */
  symbols: string[];
  /**
   * Symbols whose bodies the changed lines are in: the nearest definition above
   * each changed line within the hunk, else the one git names after the @@.
   */
  touched: string[];
  /** Added lines that branch or fall back (if/else, ??, ||, catch, default…). */
  branches: number;
  /** Symbols defined on added lines and on no removed line of the patch: new code. */
  fresh: string[];
  /** Changed values: a removed line and its closest added line, as `old → new` tokens. */
  pairs: string[];
  /** Symbols defined on this hunk's removed lines and on no added line of the patch: removed or renamed. */
  dropped: string[];
  /**
   * Conditions, quoted from code files: a changed condition as `old → new`, an
   * added branch or fallback as `+ line`, a removed condition as `- line`.
   */
  conds: string[];
  /** Test titles added in this hunk (`test('…')`, `def test_…`, `func Test…`). */
  tests: string[];
  /**
   * Removed lines that reappear, whitespace aside, as added lines of the same
   * file (moved or re-indented), or a hunk whose text is only reflowed: not a
   * changed value, condition or rule. Counted, and left out of `pairs`/`conds`.
   */
  moved?: number;
  /**
   * Functions that own this hunk's changed code: a changed code line (not a
   * comment, not moved) sits in their body. Set by `patchHunks`.
   */
  owns?: string[];
  /** Of `owns`, the functions whose changed code only reads a value (`readsOnly`). */
  readers?: string[];
  /**
   * Per function whose body a changed line is in (the nearest definition above
   * it): `name: word word …`, the lowercased words of those changed lines, so
   * a sentence can be matched to the function inside a hunk that holds several.
   */
  fnWords: string[];
  /**
   * Per function that owns changed code (see `owns`): `name: N`, its changed
   * code lines in this hunk, so a hunk's behavior goes to the function holding
   * most of it rather than the first one named.
   */
  fnLines?: string[];
  /**
   * Functions this hunk adds whose whole body is one assignment or one call
   * through (a setter, a callback): never where a reviewer starts.
   */
  thin?: string[];
  /**
   * Names this hunk shows defined as types (class, interface, enum, type alias,
   * struct, trait…) rather than functions: never where a reviewer starts.
   */
  types?: string[];
  /** Lowercased words of the changed lines (identifiers split, strings), for matching prose to code. */
  words: string[];
  /** The hunk shows the file's first line as a shebang (`#!`): a runnable script. */
  shebang?: true;
  /** Added lines start a local server (`Bun.serve`, `createServer`, `127.0.0.1`): real code runs against it. */
  localServer?: true;
  /** Test doubles the added lines name in words (`a fake release server`), lowercased. */
  fakes?: string[];
  /**
   * Up to 24 key changed lines, in patch order, for the neighborhood brief:
   * `- old ⇒ + new` for a removed line and its closest added line, then lines
   * that define a symbol or branch, then the rest; blank, brace-only and import
   * lines last. Each clipped to 160 characters.
   */
  code: string[];
  /** Normalized added lines, for matching edits. Never written out. */
  lines: Set<string>;
  /** Normalized removed lines, for matching commits that only delete. Never written out. */
  gone: Set<string>;
  /**
   * A binary file: git prints `Binary files … differ` instead of hunks. The whole
   * file is one hunk with no lines, so it still gets a change unit, its commits
   * and the requests behind them.
   */
  binary?: 'added' | 'deleted' | 'modified';
  /** Raw removed and added lines, for search indexing and key lines. Never written out. */
  minus?: string[];
  plus?: string[];
  /**
   * The changed lines without moved ones (see `moved`), for evidence that
   * quotes removed or changed code. Never written out.
   */
  keptMinus?: string[];
  keptPlus?: string[];
}

const KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'else',
  'new',
  'await',
  'typeof',
  'do',
  'try',
  'with',
  'super',
  'this',
]);
const DEFINITIONS = [
  /\b(?:function\*?|class|interface|enum|type|def|fn|struct|trait|module|record)\s+([A-Za-z_$][\w$]*)/,
  /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>|function\b)/,
  /^\s*(?:(?:export|public|private|protected|static|async|override|readonly|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^={;]+)?\{\s*$/,
];
/** The name a line of code defines, if it defines one. */
export function definedSymbol(line: string): string | undefined {
  // Imports name types (`import { type X }`) without defining them.
  if (
    /^\s*(import\b|from\s+\S+\s+import\b|use\s|using\s|#\s*include\b|export\s*\{|export\s+\*|export\s+type\s*\{)/.test(
      line,
    )
  )
    return undefined;
  // One specifier of a multi-line import or export list (`  type X,`, `  type X as Y }`).
  if (/^\s*type\s+[A-Za-z_$][\w$]*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?(?:[,}]|$)/.test(line))
    return undefined;
  for (const re of DEFINITIONS) {
    const m = re.exec(line);
    if (m?.[1] && !KEYWORDS.has(m[1])) return m[1];
  }
  return undefined;
}
/** A line that defines a type (class, interface, enum, type alias, struct…), not a function. */
export function definesType(line: string): boolean {
  const name = definedSymbol(line);
  if (!name) return false;
  const esc = name.replace(/[$]/g, '\\$');
  return new RegExp(
    `\\b(?:class|interface|enum|type|struct|trait|module|record|protocol|union)\\s+${esc}\\b`,
  ).test(line);
}
/**
 * Opens a multi-line import or export list (`import {`, `export type {`,
 * `from x import (`): the lines up to its close name, never define.
 */
const OPENS_IMPORT =
  /^\s*(?:(?:import|export)\b[^;{}]*\{[^}]*$|from\s+\S+\s+import\s*\([^)]*$|use\s+[\w:]+::\{[^}]*$)/;

/** Lines that add a branch or a fallback: each path deserves its own sentence. */
export const BRANCHING =
  /(\bif\s*\(|\bif\s+[^=]|\belse\b|\belif\b|\bswitch\s*\(|\bcase\s+[^:]+:|\bcatch\b|\bexcept\b|\?\?|\|\||\bdefault\s*:|\bfallback\b|\?\s*[^:?]+\s*:\s*)/;

/**
 * Split a `git diff` patch into hunks with their changes.patch line ranges. Hunk
 * bodies are read by the line counts in their @@ headers, so content lines that
 * look like headers (a removed "-- comment") are never mistaken for them.
 */
export function patchHunks(patch: string): PatchHunk[] {
  const lines = patch.split(/\r?\n/);
  const hunks: PatchHunk[] = [];
  let file: string | undefined;
  let oldFile: string | undefined;
  let cur: PatchHunk | undefined;
  let first = 0;
  let last = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let newLine = 0;
  let current: string | undefined;
  // Indent of the line that defined `current`; a later line at or left of it ends its body.
  let currentIndent = -1;
  // Enclosing definitions of `current` (a callback or method defined inside
  // a function): when the inner one ends, its lines below go to the outer one.
  let outer: { name: string; indent: number }[] = [];
  const resume = (indent: number) => {
    current = undefined;
    currentIndent = -1;
    while (outer.length) {
      const o = outer.pop()!;
      if (indent > o.indent) {
        current = o.name;
        currentIndent = o.indent;
        return;
      }
    }
  };
  const removedDefs = new Set<string>();
  const changed = new Map<PatchHunk, { minus: string[]; plus: string[] }>();
  // Per hunk: function → its changed lines.
  const byFn = new Map<PatchHunk, Map<string, string[]>>();
  // Changed comment lines outside any body, waiting for the definition below them.
  let pendingDoc: string[] = [];
  // Inside a multi-line import or export list: its names are not definitions.
  let inImport = false;
  const touch = (h: PatchHunk) => {
    if (current && !h.touched.includes(current)) h.touched.push(current);
  };
  const close = () => {
    if (!cur) return;
    cur.diff = last > first ? `diff:${first}-${last}` : `diff:${first}`;
    cur.end = Math.max(cur.start, newLine - 1);
    hunks.push(cur);
    cur = undefined;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const n = i + 1;
    if (cur && line.startsWith('\\')) {
      last = n; // "\ No newline at end of file"
      continue;
    }
    if (cur && (oldLeft > 0 || newLeft > 0)) {
      const c = line[0];
      const text = line.slice(1);
      if (c !== '-' && newLine === 1 && text.startsWith('#!')) cur.shebang = true;
      const indent = /^\s*/.exec(text)![0].replace(/\t/g, '    ').length;
      const listed = inImport;
      if (inImport) {
        if (/[})]/.test(text)) inImport = false;
      } else if (OPENS_IMPORT.test(text)) inImport = true;
      const def = listed ? undefined : definedSymbol(text);
      if (def && definesType(text) && !(cur.types ??= []).includes(def))
        cur.types.push(def);
      // A line back at the definition's indent ends its body: a closing brace
      // still belongs to it, anything else (the next function, a comment) doesn't.
      let closes = false;
      if (current && text.trim() && !def && indent <= currentIndent) {
        // A multi-line signature's `): T {` opens the body; it doesn't end it.
        if (/^\s*[}\])]/.test(text) && !/[{([]\s*$/.test(text)) closes = true;
        else if (!/^\s*[)\]]/.test(text)) resume(indent);
      }
      if (def) {
        if (current && indent > currentIndent)
          outer.push({ name: current, indent: currentIndent });
        else outer = outer.filter((o) => o.indent < indent);
        current = def;
        currentIndent = indent;
        // A changed doc comment right above a definition describes it.
        if (pendingDoc.length) {
          const fns = byFn.get(cur) ?? new Map<string, string[]>();
          fns.set(def, [...(fns.get(def) ?? []), ...pendingDoc]);
          byFn.set(cur, fns);
        }
        pendingDoc = [];
      } else if (text.trim() && !/^\s*(\/\/|#|\*|\/\*|@)/.test(text)) pendingDoc = [];
      if (c === '+' || c === '-') {
        touch(cur);
        const ch = changed.get(cur) ?? { minus: [], plus: [] };
        (c === '+' ? ch.plus : ch.minus).push(text);
        changed.set(cur, ch);
        if (!current && !def && /^\s*(\/\/|#|\*|\/\*)/.test(text)) pendingDoc.push(text);
        else if (current) {
          const fns = byFn.get(cur) ?? new Map<string, string[]>();
          fns.set(current, [...(fns.get(current) ?? []), text]);
          byFn.set(cur, fns);
        }
        if (c === '-' && def) {
          removedDefs.add(def);
          if (!cur.dropped.includes(def)) cur.dropped.push(def);
        }
      }
      if (closes) {
        const o = outer.pop();
        current = o?.name;
        currentIndent = o?.indent ?? -1;
      }
      if (c === '+') {
        newLeft--;
        cur.added++;
        newLine++;
        const raw = line.slice(1);
        const e = evidenceLine(raw);
        if (e) cur.lines.add(e);
        const sym = listed ? undefined : definedSymbol(raw);
        if (sym && !cur.symbols.includes(sym)) cur.symbols.push(sym);
        if (BRANCHING.test(raw) && !/^\s*(\/\/|#|\*)/.test(raw)) cur.branches++;
      } else if (c === '-') {
        oldLeft--;
        cur.removed++;
        const e = evidenceLine(line.slice(1));
        if (e) cur.gone.add(e);
      } else {
        oldLeft--;
        newLeft--;
        newLine++;
      }
      last = n;
      continue;
    }
    const h = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
    if (h && file) {
      close();
      oldLeft = h[1] === undefined ? 1 : Number(h[1]);
      newLine = Number(h[2]);
      newLeft = h[3] === undefined ? 1 : Number(h[3]);
      first = last = n;
      pendingDoc = [];
      inImport = false;
      outer = [];
      current = h[4]?.trim() ? definedSymbol(h[4]) : undefined;
      currentIndent = current ? /^\s*/.exec(h[4]!)![0].replace(/\t/g, '    ').length : -1;
      cur = {
        id: `H${hunks.length + 1}`,
        file,
        start: newLine,
        end: newLine,
        added: 0,
        removed: 0,
        diff: '',
        ...(h[4]?.trim() ? { context: clip(h[4].trim(), 160) } : {}),
        ...(h[4]?.trim() && definedSymbol(h[4]) ? { scope: definedSymbol(h[4]) } : {}),
        ...(h[4]?.trim() && definesType(h[4]) ? { types: [definedSymbol(h[4])!] } : {}),
        symbols: [],
        touched: [],
        branches: 0,
        fresh: [],
        pairs: [],
        dropped: [],
        conds: [],
        tests: [],
        fnWords: [],
        words: [],
        code: [],
        lines: new Set(),
        gone: new Set(),
      };
      continue;
    }
    close();
    const bin =
      /^Binary files (?:a\/(.+?)|\/dev\/null) and (?:b\/(.+?)|\/dev\/null) differ$/.exec(
        line,
      );
    if (bin && (bin[1] || bin[2])) {
      hunks.push({
        id: `H${hunks.length + 1}`,
        file: (bin[2] ?? bin[1])!,
        start: 0,
        end: 0,
        added: 0,
        removed: 0,
        diff: `diff:${n}`,
        binary: !bin[1] ? 'added' : !bin[2] ? 'deleted' : 'modified',
        symbols: [],
        touched: [],
        branches: 0,
        fresh: [],
        pairs: [],
        dropped: [],
        conds: [],
        tests: [],
        fnWords: [],
        words: [],
        code: [],
        lines: new Set(),
        gone: new Set(),
      });
      file = oldFile = undefined;
    } else if (
      line.startsWith('diff --git ') ||
      line.startsWith('Untracked content sha256:') ||
      line.startsWith('Binary file')
    )
      file = oldFile = undefined;
    else if (line.startsWith('--- ')) {
      const p = line.slice(4).trim();
      oldFile = p === '/dev/null' ? undefined : p.replace(/^a\//, '');
    } else if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      file = p === '/dev/null' ? oldFile : p.replace(/^b\//, '');
    }
  }
  close();
  const addedDefs = new Set(hunks.flatMap((h) => h.symbols));
  // Per file, the added and removed lines whitespace-normalized: a removed line
  // that comes back elsewhere in the file was moved, not changed.
  const perFile = new Map<string, { minus: string[]; plus: string[] }>();
  for (const h of hunks) {
    const ch = changed.get(h) ?? { minus: [], plus: [] };
    const f = perFile.get(h.file) ?? { minus: [], plus: [] };
    f.minus.push(...ch.minus);
    f.plus.push(...ch.plus);
    perFile.set(h.file, f);
  }
  // One budget per file and side, shared by the file's hunks: a line moved
  // once is cancelled once on each side, wherever its hunks are.
  const movedOf = new Map(
    [...perFile].map(([f, x]) => {
      const m = movedLines(x.minus, x.plus);
      return [f, { minus: new Map(m), plus: new Map(m) }] as const;
    }),
  );
  for (const h of hunks) {
    h.fresh = h.symbols.filter((x) => !removedDefs.has(x));
    h.dropped = h.dropped.filter((x) => !addedDefs.has(x));
    const ch = changed.get(h) ?? { minus: [], plus: [] };
    const kept = withoutMoved(
      ch.minus,
      ch.plus,
      movedOf.get(h.file)!,
      PROSE_FILE.test(h.file),
    );
    if (kept.moved) h.moved = kept.moved;
    // Functions whose own changed code survives the moved lines: only these
    // own a change (a function whose lines only moved, or that git names
    // after the @@ while the changes sit below it, does not).
    const left = new Map<string, number>();
    for (const l of [...kept.minus, ...kept.plus].map(normLine))
      left.set(l, (left.get(l) ?? 0) + 1);
    h.owns = [];
    h.readers = [];
    h.fnLines = [];
    for (const [fn, ls] of byFn.get(h) ?? []) {
      const code = ls.filter(isCodeLine);
      // Each kept (not moved) changed code line in the function's body.
      const kept = code.filter((l) => {
        const k = normLine(l);
        const n = left.get(k) ?? 0;
        if (n <= 0) return false;
        left.set(k, n - 1);
        return true;
      }).length;
      if (!kept) continue;
      h.owns.push(fn);
      h.fnLines.push(`${fn}: ${kept}`);
      if (readsOnly(code)) h.readers.push(fn);
      if (h.symbols.includes(fn) && !h.dropped.includes(fn) && thinBody(fn, code))
        (h.thin ??= []).push(fn);
    }
    h.pairs = valuePairs(kept.minus, kept.plus);
    h.conds = PROSE_FILE.test(h.file)
      ? []
      : conditionFacts(kept.minus, kept.plus, h.pairs);
    h.tests = uniqStrings(ch.plus.flatMap(testTitles)).slice(0, 8);
    if (ch.plus.some((l) => LOCAL_SERVER.test(l))) h.localServer = true;
    const fakes = uniqStrings(ch.plus.flatMap(fakePhrases)).slice(0, 4);
    if (fakes.length) h.fakes = fakes;
    h.words = uniqStrings([...ch.minus, ...ch.plus].flatMap(wordsOf)).slice(0, 400);
    h.fnWords = [...(byFn.get(h) ?? [])].map(
      ([fn, ls]) => `${fn}: ${uniqStrings(ls.flatMap(wordsOf)).slice(0, 120).join(' ')}`,
    );
    // Key lines never quote a moved line as removed; a hunk that only moved
    // code shows where it now sits.
    const pureMove = !kept.minus.length && !kept.plus.length;
    h.keptMinus = kept.minus;
    h.keptPlus = pureMove ? ch.plus : kept.plus;
    h.code = keyCodeLines(h.keptMinus, h.keptPlus);
    h.minus = ch.minus;
    h.plus = ch.plus;
  }
  return hunks;
}

const KEY_LINES = 24;
const KEY_TOKEN = /[A-Za-z_$][\w$]*|\d[\d_.]*|'[^']*'|"[^"]*"|`[^`]*`/g;
const tokSet = (l: string) => new Set(l.match(KEY_TOKEN) ?? []);
const clipCode = (l: string) => {
  const t = l.replace(/\s+/g, ' ').trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
};

/**
 * The few changed lines that say most about a hunk (see `PatchHunk.code`).
 * Exported for tests.
 */
export function keyCodeLines(minus: string[], plus: string[], max = KEY_LINES): string[] {
  type Cand = { order: number; text: string; rank: number };
  const cands: Cand[] = [];
  const low = (l: string) =>
    !l.trim() ||
    /^\s*[{}()[\];,]*\s*$/.test(l) ||
    /^\s*(import\b|from\s+\S+\s+import\b|#\s*include\b|use\s)/.test(l) ||
    isComment(l);
  // Pair each removed line with its most similar added line (shared tokens).
  const usedPlus = new Set<number>();
  const pairedMinus = new Set<number>();
  minus.forEach((r, i) => {
    if (low(r)) return;
    const rt = tokSet(r);
    if (!rt.size) return;
    let best = -1;
    let score = 0;
    plus.forEach((a, j) => {
      if (usedPlus.has(j) || low(a)) return;
      const at = tokSet(a);
      let shared = 0;
      for (const t of rt) if (at.has(t)) shared++;
      const s = shared / Math.max(rt.size, at.size);
      if (s > score) {
        score = s;
        best = j;
      }
    });
    if (best >= 0 && score >= 0.5 && r.trim() !== plus[best]!.trim()) {
      usedPlus.add(best);
      pairedMinus.add(i);
      cands.push({
        order: best,
        text: `- ${clipCode(r)}  ⇒  + ${clipCode(plus[best]!)}`,
        rank: 0,
      });
    }
  });
  const rankOf = (l: string) =>
    low(l) ? 3 : definedSymbol(l) || (BRANCHING.test(l) && !isComment(l)) ? 1 : 2;
  plus.forEach((a, j) => {
    if (!usedPlus.has(j))
      cands.push({ order: j, text: `+ ${clipCode(a)}`, rank: rankOf(a) });
  });
  // Removed lines without a partner sort after the added lines near them.
  minus.forEach((r, i) => {
    if (!pairedMinus.has(i))
      cands.push({
        order: (i / Math.max(1, minus.length)) * plus.length + 0.5,
        text: `- ${clipCode(r)}`,
        rank: rankOf(r),
      });
  });
  const useful = cands.some((c) => c.rank < 3);
  return cands
    .filter((c) => c.text.length > 2 && (c.rank < 3 || !useful))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, max)
    .sort((a, b) => a.order - b.order)
    .map((c) => c.text);
}

const uniqStrings = (xs: string[]) => [...new Set(xs)];
const CODE_TOKEN =
  /'[^']*'|"[^"]*"|`[^`]*`|\d[\d_.]*\w*|[A-Za-z_$][\w$]*(?:[.:/-][A-Za-z_$][\w$]*)*/g;
const isComment = (l: string) => /^\s*(\/\/|#(?!\[)|\*|\/\*|--\s)/.test(l);

/** A line with whitespace collapsed; blank or brace-only lines are no evidence of a move. */
const normLine = (l: string) => l.replace(/\s+/g, ' ').trim();
const MOVABLE = (l: string) => /[\w'"`]/.test(l) && l.length >= 6;
/** A line that starts or addresses a server on this machine. */
export const LOCAL_SERVER =
  /\bBun\.serve\(|\b(?:http|https|net)\.createServer\(|\bcreateServer\(|\bHTTPServer\(|\bhttptest\.NewServer|\bTestServer\b|\b(?:localhost|127\.0\.0\.1)(?::\d+|\b)/;
/**
 * Test doubles a line names in words, inside a string or comment: "a fake
 * release server", "mock registry". The double word and up to three words
 * after it, lowercased; never code identifiers.
 */
export function fakePhrases(line: string): string[] {
  const text = [
    ...(line.match(/(['"`])(?:(?!\1).)*\1/g) ?? []),
    ...(line.match(/(?:\/\/|#|\/\*)\s.*$/) ?? []),
  ].join(' ');
  const out: string[] = [];
  for (const m of text.matchAll(
    /\b(fake|mock|stub(?:bed)?|dummy)\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})/gi,
  )) {
    const words = m[2]!
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    // Stop at a word that starts a clause.
    const cut = words.findIndex((w) =>
      /^(?:and|or|but|that|which|with|for|the|when|then|returns?|to|in|on|is|are|was)$/.test(
        w,
      ),
    );
    const kept = cut < 0 ? words : words.slice(0, cut);
    if (kept.length)
      out.push(`${m[1]!.toLowerCase().replace(/^stubbed$/, 'stub')} ${kept.join(' ')}`);
  }
  return out;
}

/** A changed line that is code: not blank, brace-only or a comment. */
const isCodeLine = (l: string) => /[\w'"`]/.test(l) && !isComment(l);

/** Calls that only convert a value they read. */
const CONVERSION =
  /^(?:Number|String|Boolean|BigInt|parseInt|parseFloat|int|str|bool|float)$/;

/**
 * Whether a function's changed code only reads a value: a one-expression
 * body (`() => Number(process.env.X) || 10`, `get size() { return this.n; }`)
 * that assigns nothing, branches no statement and calls nothing but value
 * conversions. Such a getter holds a setting; the behavior lives where it is
 * used, so it is never named as the place a change starts.
 */
export function readsOnly(code: string[]): boolean {
  if (!code.length || code.length > 3) return false;
  const text = code.join(' ');
  const at = /=>|\breturn\b/.exec(text);
  if (!at) return false;
  // Before the value only the definition itself (`get size() {`, `const f = () =>`):
  // a `return` after a statement (`if (x) return 0;`) is a branch, not a getter.
  const prefix = text.slice(0, at.index).trim();
  if (prefix && !(definedSymbol(code[0]!) && prefix.length <= code[0]!.trim().length))
    return false;
  const body = text
    .slice(at.index + at[0].length)
    .replace(/^\s*\{?\s*(?:return\b)?/, '')
    .replace(/[\s;}]+$/, '');
  if (!body.trim() || /;|\{/.test(body)) return false;
  if (/\b(?:if|for|while|switch|await|new|throw|yield|delete)\b/.test(body)) return false;
  // An assignment (not `==`, `=>`, `<=`, `>=`, `!=`).
  if (/(?<![=!<>])=(?![=>])/.test(body)) return false;
  const calls = [...body.matchAll(/([A-Za-z_$][\w$.]*)\s*\(/g)].map((m) =>
    m[1]!.split('.').pop()!,
  );
  return calls.every((c) => CONVERSION.test(c));
}

const ONE_ASSIGNMENT =
  /^\s*(?:(?:const|let|var|self\.|this\.)\s*)?[\w$.[\]'"]+\s*(?:[-+*/%|&^]|\?\?|\|\||&&)?=(?![=>])[^;]*;?\s*$/;
const ONE_CALL =
  /^\s*(?:(?:return|await|void)\s+)*[\w$.]+\s*\((?:[^()]|\([^()]*\))*\)\s*;?\s*$/;
/**
 * A new function whose whole body is one statement that assigns a value or
 * calls through to another function (`setX(v) { this.x = v; }`,
 * `const onDone = (r) => finish(r);`). `code` is its changed code lines, the
 * definition line among them.
 */
export function thinBody(fn: string, code: string[]): boolean {
  const defAt = code.findIndex((l) => definedSymbol(l) === fn);
  if (defAt < 0) return false;
  const body = code
    .filter((_, i) => i !== defAt)
    .map((l) => l.trim())
    .filter((l) => !/^[{}()[\];,\s]*$/.test(l));
  const def = code[defAt]!;
  // A one-line definition: the body follows `=>` or `{` on the same line.
  const inline =
    /=>\s*(.+?)\s*;?\s*$/.exec(def)?.[1] ?? /\{\s*(.+?)\s*\}\s*;?\s*$/.exec(def)?.[1];
  const stmts =
    inline && !/^\{?\s*$/.test(inline) ? [inline.replace(/^\{\s*/, ''), ...body] : body;
  if (stmts.length !== 1) return false;
  const one = stmts[0]!.replace(/^\s*return\s+(?=[\w$.]+\s*\()/, '');
  if (/\b(?:if|for|while|switch|try|catch|else|throw)\b/.test(one)) return false;
  return ONE_ASSIGNMENT.test(one) || ONE_CALL.test(one);
}

/**
 * Lines removed and added again (whitespace-normalized) in one file, as a
 * multiset: how many times each such line can be cancelled on either side.
 */
export function movedLines(minus: string[], plus: string[]): Map<string, number> {
  const count = (ls: string[]) => {
    const m = new Map<string, number>();
    for (const l of ls.map(normLine).filter(MOVABLE)) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(minus);
  const b = count(plus);
  const out = new Map<string, number>();
  for (const [l, n] of a) if (b.has(l)) out.set(l, Math.min(n, b.get(l)!));
  return out;
}

/**
 * A hunk's changed lines without the moved ones (see `movedLines`; the budget
 * is shared across the file's hunks). For prose, a hunk whose remaining
 * removed and added text is the same once whitespace is collapsed was only
 * reflowed: none of it is a change.
 */
export function withoutMoved(
  minus: string[],
  plus: string[],
  /** `movedLines` of the file; or per-side budgets the file's hunks share (spent here). */
  moved: Map<string, number> | { minus: Map<string, number>; plus: Map<string, number> },
  prose = false,
): { minus: string[]; plus: string[]; moved: number } {
  const take = (ls: string[], budget: Map<string, number>) =>
    ls.filter((l) => {
      const k = normLine(l);
      const n = budget.get(k) ?? 0;
      if (n <= 0) return true;
      budget.set(k, n - 1);
      return false;
    });
  const budgets =
    moved instanceof Map ? { minus: new Map(moved), plus: new Map(moved) } : moved;
  const m = take(minus, budgets.minus);
  const p = take(plus, budgets.plus);
  const count = minus.length - m.length;
  if (prose && m.length && p.length && normLine(m.join(' ')) === normLine(p.join(' ')))
    return { minus: [], plus: [], moved: count + m.length };
  return { minus: m, plus: p, moved: count };
}

/**
 * Old → new values: each removed line paired with its most similar added line,
 * kept when a few tokens differ and one of them is a number or string literal
 * (`last + 30 * 60_000 → last + 5 * 60_000`).
 */
export function valuePairs(minus: string[], plus: string[]): string[] {
  const toks = (l: string): string[] => l.match(CODE_TOKEN) ?? [];
  const out: string[] = [];
  const used = new Set<number>();
  for (const r of minus) {
    if (isComment(r) || r.trim().length < 4) continue;
    const rt = toks(r);
    if (!rt.length) continue;
    let best = -1;
    let score = 0;
    plus.forEach((a, i) => {
      if (used.has(i) || isComment(a)) return;
      const at = toks(a);
      const inter = rt.filter((t) => at.includes(t)).length;
      const j = inter / new Set([...rt, ...at]).size;
      if (j > score) {
        score = j;
        best = i;
      }
    });
    if (best < 0 || score < 0.4 || score >= 1) continue;
    const added = plus[best]!;
    const at = toks(added);
    const was = rt.filter((t) => !at.includes(t));
    const now = at.filter((t) => !rt.includes(t));
    // A changed value, not a rename or a rewrite: few tokens differ, and a
    // number or string literal is among them.
    const literal = (t: string) => /^(\d|['"`])/.test(t);
    if (!was.length || !now.length || was.length > 4 || now.length > 4) continue;
    if (!was.some(literal) && !now.some(literal)) continue;
    used.add(best);
    out.push(`${clip(r.trim(), 80)} → ${clip(added.trim(), 80)}`);
  }
  return uniqStrings(out).slice(0, 4);
}

/** Files whose lines are prose or data, not code: an "if" there is a word. */
export const PROSE_FILE =
  /\.(md|mdx|txt|rst|adoc|json|jsonc|ya?ml|toml|lock|csv|svg|html?|xml|ini|cfg)$|(^|\/)VERSION$|(^|\/)(?:LICEN[CS]E|NOTICE|COPYING|AUTHORS|CHANGELOG|README)(?:\.[\w-]+)?$/i;
/** A line's code with string contents blanked, so an "if" or "??" in a string doesn't count. */
const codeOnly = (l: string) =>
  l.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, '""');
const CONDITION = /^\s*(?:\}\s*)?(?:else\s+)?(?:if|elif|while|unless)\b\s*[(\w!]/;
const FALLBACK = /\?\?|\s\?\s[^:]+\s:\s|\|\|\s*(?:\d|['"`[{]|null|undefined|true|false)/;
const BARE =
  /^\s*(?:\}\s*)?(?:else|catch|except|finally|default\s*:)\b[^;]*$|^\s*\}?\s*catch\s*(?:\([^)]*\))?\s*\{?\s*$/;
const CATCH = /^\s*(?:\}\s*)?(?:catch|except)\b|^\s*default\s*:|^\s*case\s+[^:]+:/;
const CONDITION_TOKEN =
  /'[^']*'|"[^"]*"|`[^`]*`|\d[\d_.]*\w*|[A-Za-z_$][\w$]*(?:[.:/-][A-Za-z_$][\w$]*)*|[<>!=]=?=?|&&|\|\||\?\?/g;
const CONDITION_WORDS = new Set(
  'if elif else while unless return const let var await new catch except case default'.split(
    ' ',
  ),
);
/** The condition an `if`/`while` line tests (balanced parentheses, or up to a Python colon). */
function testOf(l: string): string {
  const c = codeOnly(l);
  const m = /\b(?:if|elif|while|unless)\b\s*/.exec(c);
  if (!m) return c.trim();
  const rest = c.slice(m.index + m[0].length);
  if (!rest.startsWith('(')) return rest.replace(/:\s*$/, '').trim();
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '(') depth++;
    else if (rest[i] === ')' && --depth === 0) return rest.slice(0, i + 1);
  }
  return rest.trim();
}
const tidy = (l: string) =>
  l
    .trim()
    .replace(/\s*\{\s*$/, '')
    .replace(/\s+/g, ' ');

/**
 * What changed in a hunk's conditions, quoted from its lines: conditions whose
 * comparison or operands changed (`if (n >= 10) → if (n >= 12)`), added
 * branches and fallbacks (`+ if (!cmd) return;`, `+ const n = opts.limit ?? 20;`)
 * and removed conditions (`- if (legacy)`). Value changes already in `pairs`
 * are not repeated. At most six, in diff order within each kind.
 */
export function conditionFacts(
  minus: string[],
  plus: string[],
  pairs: string[] = [],
): string[] {
  // Keywords match any two conditions; only operands and operators tell them apart.
  const toks = (l: string): string[] =>
    (codeOnly(l).match(CONDITION_TOKEN) ?? []).filter((t) => !CONDITION_WORDS.has(t));
  const kind = (l: string) => {
    // Conditions inside template text (`${a ? b : c}`) render output; they aren't control flow.
    if (isComment(l) || !l.trim() || l.includes('${')) return undefined;
    const c = codeOnly(l);
    if (CONDITION.test(c)) return 'if';
    if (CATCH.test(c)) return 'catch';
    // A fallback whose line breaks mid-call is a fragment, not a fact.
    if (FALLBACK.test(c) && !/[([]\s*$/.test(c)) return 'fallback';
    return undefined;
  };
  const gone = minus.map((l, i) => ({ l, i, k: kind(l) })).filter((x) => x.k);
  const added = plus.map((l, i) => ({ l, i, k: kind(l) })).filter((x) => x.k);
  const inPairs = (l: string) => pairs.some((p) => p.startsWith(clip(l.trim(), 80)));
  const changed: string[] = [];
  const used = new Set<number>();
  const paired = new Set<number>();
  for (const r of gone) {
    const rt = new Set(toks(r.l));
    let best = -1;
    let score = 0;
    for (const a of added) {
      if (used.has(a.i) || a.k !== r.k) continue;
      const at = new Set(toks(a.l));
      const j = [...rt].filter((t) => at.has(t)).length / new Set([...rt, ...at]).size;
      if (j > score) {
        score = j;
        best = a.i;
      }
    }
    if (best < 0 || score < 0.4) continue;
    used.add(best);
    paired.add(r.i);
    // Same condition, different body: not a change of condition.
    if (score >= 1 || inPairs(r.l) || testOf(r.l) === testOf(plus[best]!)) continue;
    changed.push(`${clip(tidy(r.l), 75)} → ${clip(tidy(plus[best]!), 75)}`);
  }
  const line = (l: string, i: number) => {
    // A bare `else`, `catch` or `default:` says little alone: quote what it does.
    if (!BARE.test(codeOnly(l))) return tidy(l);
    const next = plus.slice(i + 1).find((x) => x.trim() && !isComment(x));
    return next ? `${tidy(l)} { ${tidy(next)}` : tidy(l);
  };
  const literal = (l: string) =>
    /[<>]=?\s*-?\d|[=!]==?\s*(?:-?\d|['"`])|\?\?\s*(?:-?\d|['"`])/.test(l);
  const fresh = added.filter((a) => !used.has(a.i));
  const order = [
    ...fresh.filter((a) => literal(a.l)),
    ...fresh.filter((a) => !literal(a.l) && a.k !== 'if'),
    ...fresh.filter((a) => !literal(a.l) && a.k === 'if'),
  ];
  const removed = gone.filter((r) => !paired.has(r.i) && r.k === 'if');
  return uniqStrings([
    ...changed,
    ...order.map((a) => `+ ${clip(line(a.l, a.i), 150)}`),
    ...removed.map((r) => `- ${clip(tidy(r.l), 150)}`),
  ]).slice(0, 6);
}

/** Test titles a line adds: `test('…')`, `it("…")`, `describe(…)`, `def test_x`, `func TestX`. */
export function testTitles(line: string): string[] {
  const m =
    /\b(?:test|it|describe|context)(?:\.\w+)?\s*\(\s*(['"`])((?:(?!\1).){3,140})\1/.exec(
      line,
    ) ??
    /\bdef\s+(test_\w+)/.exec(line) ??
    /\bfunc\s+(Test\w+)/.exec(line);
  if (!m) return [];
  return [String(m[2] ?? m[1])];
}

/** Lowercased words of a code line: identifiers split at case and underscores, string contents. */
export function wordsOf(line: string): string[] {
  return (line.match(/[A-Za-z][a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? [])
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3 || /^\d+$/.test(w));
}

const firstLine = (s: string) =>
  s
    .split('\n')
    .find((l) => l.trim())
    ?.replace(/^#+\s*/, '') ?? '';

export interface GraphInputs {
  full: TraceDigest;
  trails: SessionTrail[];
  patch: string;
  /** Short or full commit SHA → repo-relative paths it touched. */
  commitFiles?: Map<string, string[]>;
  /** Full commit SHA → file → normalized lines the commit added (its own patch); removed lines are prefixed with "-". */
  commitLines?: Map<string, Map<string, string[]>>;
}

/** Commit-message sentences that report a result rather than explain a change. */
const RESULT_CLAIM =
  /(\b\d+\s*\/\s*\d+\b|\b\d+\s+(?:pass|passed|passing|fail|failed|failing|tests?|checks?|cases?)\b|\b(?:tests?|checks?|suite|evals?|build|ci)\s+(?:now\s+)?(?:pass|passes|passed|green|succeed|succeeds)\b|\ball\s+(?:tests|checks)\b|\bverified\b|\bconfirmed\b)/i;

/** A commit body as separate sentences or bullets, each attributable on its own. */
export function commitSentences(body: string): string[] {
  return (
    body
      .split(/\n\s*\n|\n(?=\s*(?:[-*•]|\d+[.)])\s)/)
      .flatMap((para) =>
        para
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
          .split(/(?<=[.!?])\s+(?=[A-Z`"'(])/),
      )
      .map((x) => x.trim())
      // Trailers (Co-Authored-By: …, Signed-off-by: …) are not explanations.
      .filter(
        (x) => x.length > 3 && !/^[A-Za-z][\w-]*-[Bb]y:\s|^[A-Z][\w-]+:\s*\S+@/.test(x),
      )
  );
}

/** A record that ends cut off: an ellipsis or a truncation marker at its end. */
const RECORD_TRUNCATED = /(?:…|\.\.\.|\[(?:truncated|…)\]|<truncated>)\s*["'”)]*\s*$/i;

/** Each question with its answer, without the questions repeated: `Q? = "A"` joined by ` / `. */
function decisionAnswers(
  d: TraceDigest['sessions'][number]['decisions'][number],
): string | null {
  if (!d.questions?.length) return null;
  // A question with no recorded answer decided nothing: left out.
  const answered = d.questions.filter(
    (q) => q.answer !== undefined && q.answer.trim() !== '',
  );
  if (!answered.length) return null;
  return clip(
    answered
      .map(
        (q) =>
          `${clip(q.question.replace(/\s+/g, ' '), 200)} = "${clip(q.answer!.replace(/\s+/g, ' '), 300)}"${q.ownWords ? ' (own words)' : ''}`,
      )
      .join(' / '),
    1200,
  );
}

/** A decision made only of questions, none with a recorded answer: nothing was decided. */
export function unansweredDecision(
  d: TraceDigest['sessions'][number]['decisions'][number],
): boolean {
  return !!d.questions?.length && decisionAnswers(d) === null;
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.');

/** Code run by hand or by tooling, not shipped: `scripts/`, `tools/`, `bin/`, benchmarks, examples. */
const SCRIPT_PATH = /^(?:scripts?|tools?|bin|bench(?:marks?)?|examples?)\//i;
/** A file's part in a change unit: shipped source, a script, a test, or other (docs, config…). */
export function unitRole(
  file: string,
  role: string,
): 'src' | 'scripts' | 'tests' | 'other' {
  if (role === 'tests') return 'tests';
  if (role !== 'behavior') return 'other';
  return SCRIPT_PATH.test(file) ? 'scripts' : 'src';
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether any of the names appears as a whole word in the hunks' changed lines. */
const namesIn = (names: string[], hs: PatchHunk[]) => {
  const text = hs.flatMap((h) => [...h.lines, ...h.gone, ...h.code]).join('\n');
  return names.some(
    (n) => n.length >= 3 && new RegExp(`\\b${escapeRe(n)}\\b`).test(text),
  );
};
/** Words of symbols and file names: what a test about that code would mention. */
const unitWords = (hs: PatchHunk[]) =>
  new Set(
    hs.flatMap((h) => [
      ...[...h.touched, ...h.fresh, ...h.symbols].flatMap(wordsOf),
      ...wordsOf(
        (h.file.split('/').pop() ?? '').replace(/\.[^.]+$/, '').replace(/[-_.]/g, ' '),
      ),
    ]),
  );

/** A literal or short expression a flag falls back to: `?? "bin/x"`, `|| 5`, `default: 3`, `default=3`. */
const FLAG_DEFAULT =
  /(?:\?\?|\|\||\bdefault\s*[:=])\s*((?:join|resolve|path\.join)?\(?\s*(?:"[^"]*"|'[^']*'|`[^`]*`|-?\d[\d_.]*|true|false|null|None)(?:\s*,\s*(?:"[^"]*"|'[^']*'|`[^`]*`|-?\d[\d_.]*))*\s*\)?)/;

/** The fallback after a flag's read: `?? <expr>` / `|| <expr>` up to its closing bracket, or `default: <literal>`. */
function flagDefault(rest: string): string | undefined {
  const m = /^\s*\)?\s*(?:\?\?|\|\|)\s*/.exec(rest);
  if (!m) return FLAG_DEFAULT.exec(rest)?.[1]?.trim();
  let depth = 0;
  let out = '';
  for (const ch of rest.slice(m[0].length)) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) {
      if (depth === 0) break;
      depth--;
    }
    if ((ch === ';' || ch === ',') && depth === 0) break;
    out += ch;
  }
  const v = out.trim();
  return v && /["'`\d]|true|false/.test(v) ? v : undefined;
}

/**
 * A new script's interface from its added lines: each flag it parses (a
 * quoted `--flag` on a line that reads arguments), with its default when the
 * line gives one, then the lines that decide pass or fail (an exit status, a
 * PASS/FAIL message). Clipped and capped.
 */
export function scriptInterface(plus: string[]): string[] {
  const flags = new Map<string, string | undefined>();
  const outcomes: string[] = [];
  for (const raw of plus) {
    const l = raw.trim();
    if (!l || /^(?:\/\/|#(?!!)|\/\*|\*)/.test(l)) continue;
    const parsesArgs =
      /\b(?:args?|argv|argument|options?|opts|flags?|value|has|includes|getopt\w*|parse\w*|add_argument|case)\b/i.test(
        l,
      );
    if (parsesArgs)
      for (const m of l.matchAll(/(['"`])(--[a-z][\w-]*)(?:[= ][^'"`]*)?\1/g)) {
        const name = m[2]!;
        const def = flagDefault(l.slice(m.index! + m[0].length));
        if (!flags.has(name) || (def && !flags.get(name)))
          flags.set(
            name,
            def ? (def.length > 60 ? `${def.slice(0, 59)}…` : def) : undefined,
          );
      }
    if (
      /\b(?:process\.exit|sys\.exit|os\.exit|Deno\.exit)\s*\(|^\s*exit\s+\d|\bprocess\.exitCode\s*=(?!=)/.test(
        l,
      ) ||
      /(['"`])[^'"`]*\b(?:PASS|FAIL)\b/.test(l)
    ) {
      const t = l.replace(/\s+/g, ' ');
      outcomes.push(t.length > 110 ? `${t.slice(0, 109)}…` : t);
    }
  }
  return [
    ...[...flags].map(([f, d]) => (d ? `${f} (default ${d})` : f)),
    ...[...new Set(outcomes)].slice(0, 4).map((o) => `pass/fail: ${o}`),
  ].slice(0, 16);
}

/** A comment line in source code (normalized, possibly `-` for a removed line). */
export function isCommentLine(line: string, path: string): boolean {
  const l = line.replace(/^-/, '').trim();
  if (!l) return true;
  if (/^(\/\/|\/\*|\*\/?|<!--|-->)/.test(l)) return true;
  // `#` comments: shell, Python, Ruby, YAML, TOML, Makefiles, not C's #include.
  if (l.startsWith('#') && !/\.(c|cc|cpp|cxx|h|hpp|m|mm|cs)$/i.test(path)) return true;
  if (/^--(\s|$)/.test(l) && /\.(sql|lua|hs|elm)$/i.test(path)) return true;
  return false;
}

/**
 * Whether a commit's own lines (file -> normalized lines, removed ones with a
 * leading `-`) touch only comments, docs or test files.
 */
export function commentOrTestOnly(files: Map<string, string[]>): boolean {
  if (!files.size) return false;
  for (const [path, lines] of files) {
    const role = fileRole(path);
    if (role === 'tests' || role === 'docs') continue;
    if (!lines.every((l) => isCommentLine(l, path))) return false;
  }
  return true;
}

/**
 * One commit or request can hold a source change and an unrelated script
 * change (an eval harness pinned in the same commit). When a unit's source and
 * script hunks name none of each other's symbols, the script hunks become a
 * change of their own, and each test file goes with the side whose symbol and
 * file words its titles and lines share most (ties stay with the source).
 * Docs, config and version files stay with the source. Deterministic: the new
 * unit's key is the old key plus `|scripts`.
 */
export function splitScriptUnits(
  groups: Map<string, PatchHunk[]>,
  roleOf: (f: string) => string,
): void {
  for (const [key, hs] of [...groups]) {
    const part = (h: PatchHunk) => unitRole(h.file, roleOf(h.file));
    const src = hs.filter((h) => part(h) === 'src');
    const scripts = hs.filter((h) => part(h) === 'scripts');
    if (!src.length || !scripts.length) continue;
    const names = (xs: PatchHunk[]) => [
      ...new Set(xs.flatMap((h) => [...h.touched, ...h.fresh, ...h.symbols])),
    ];
    if (namesIn(names(src), scripts) || namesIn(names(scripts), src)) continue;
    const srcWords = unitWords(src);
    const scriptWords = unitWords(scripts);
    const toScripts = new Set<string>(scripts.map((h) => h.file));
    const testFiles = [
      ...new Set(hs.filter((h) => part(h) === 'tests').map((h) => h.file)),
    ];
    for (const f of testFiles) {
      const words = new Set(
        hs
          .filter((h) => h.file === f)
          .flatMap((h) => [...h.words, ...h.tests.flatMap(wordsOf)]),
      );
      const score = (side: Set<string>) => [...side].filter((w) => words.has(w)).length;
      if (score(scriptWords) > score(srcWords)) toScripts.add(f);
    }
    groups.set(
      key,
      hs.filter((h) => !toScripts.has(h.file)),
    );
    groups.set(
      `${key}|scripts`,
      hs.filter((h) => toScripts.has(h.file)),
    );
  }
}
/** A CI workflow file. */
const WORKFLOW_UNIT_FILE =
  /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)azure-pipelines\.ya?ml$/;
/** Changed lines from which a workflow file is its own change unit. */
const WORKFLOW_UNIT_LINES = 12;

/**
 * Each substantially changed CI workflow file (WORKFLOW_UNIT_LINES changed
 * lines or more) that shares a unit with other files becomes a unit of its
 * own, so its jobs are described apart from the code and docs beside it.
 * Deterministic: the new unit's key is the old key plus `|workflow:<file>`.
 */
export function splitWorkflowUnits(groups: Map<string, PatchHunk[]>): void {
  for (const [key, hs] of [...groups]) {
    const files = [...new Set(hs.map((h) => h.file))];
    if (files.length < 2) continue;
    const big = files.filter(
      (f) =>
        WORKFLOW_UNIT_FILE.test(f) &&
        hs.filter((h) => h.file === f).reduce((n, h) => n + h.added + h.removed, 0) >=
          WORKFLOW_UNIT_LINES,
    );
    if (!big.length) continue;
    const rest = hs.filter((h) => !big.includes(h.file));
    if (rest.length) groups.set(key, rest);
    else groups.delete(key);
    for (const f of big.sort())
      groups.set(
        `${key}|workflow:${f}`,
        hs.filter((h) => h.file === f),
      );
  }
}

/**
 * A unit that is one changed line (one added and/or one removed line) in
 * files another unit also changes joins the unit holding most of that file's
 * changed lines: a stray line is no change of its own.
 */
export function foldStrayLines(groups: Map<string, PatchHunk[]>): void {
  for (const [key, hs] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!groups.has(key)) continue;
    const files = [...new Set(hs.map((h) => h.file))];
    if (files.length !== 1) continue;
    const added = hs.reduce((n, h) => n + h.added, 0);
    const removed = hs.reduce((n, h) => n + h.removed, 0);
    if (added > 1 || removed > 1) continue;
    const f = files[0]!;
    const host = [...groups]
      .filter(([k]) => k !== key)
      .map(([k, xs]) => ({
        k,
        n: xs.filter((h) => h.file === f).reduce((a, h) => a + h.added + h.removed, 0),
      }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k))[0];
    if (!host) continue;
    groups.set(host.k, [...groups.get(host.k)!, ...hs]);
    groups.delete(key);
  }
}

const RUN_WHEN: Record<string, string> = {
  'no later edits seen':
    'after the last edit the logs captured (edits outside the logs are not ruled out)',
  'before later edits': 'before later edits (stale for the files edited after it)',
  'after later work': 'after later work (tested code that is not this PR)',
  unknown: 'unknown',
};

export function buildEvidenceGraph(input: GraphInputs): EvidenceGraph {
  const { full, trails } = input;
  const nodes = new Map<string, GraphNode>();
  const rels: GraphRel[] = [];
  const relSeen = new Set<string>();
  const node = (label: NodeLabel, id: string, props: Record<string, Value>) => {
    const key = `${label}|${id}`;
    const existing = nodes.get(key);
    if (existing) Object.assign(existing.props, props);
    else nodes.set(key, { label, id, props });
  };
  const rel = (
    type: GraphRel['type'],
    from: [NodeLabel, string],
    to: [NodeLabel, string],
    props?: Record<string, Value>,
  ) => {
    const key = `${type}|${from.join(':')}|${to.join(':')}`;
    if (relSeen.has(key)) return;
    relSeen.add(key);
    rels.push({
      type,
      from: { label: from[0], id: from[1] },
      to: { label: to[0], id: to[1] },
      ...(props ? { props } : {}),
    });
  };

  // Files in the PR, with their attribution from the digest.
  const prFiles = new Map(full.files.map((f) => [f.path, f]));
  for (const f of full.files)
    node('File', f.path, {
      role: f.role ?? fileRole(f.path),
      inPr: true,
      added: f.added,
      removed: f.removed,
      unmatched: f.unmatchedLines,
    });

  // Hunks of the submitted patch.
  const hunks = patchHunks(input.patch).filter((h) => prFiles.has(h.file));
  // A new script's interface: the flags it parses (with defaults) and what it
  // prints or exits on to pass or fail, from its added lines.
  {
    const byFile = new Map<string, PatchHunk[]>();
    for (const h of hunks) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h]);
    for (const [file, hs] of byFile) {
      const isNew = hs.every((h) => h.removed === 0) && hs.some((h) => h.start === 1);
      const script =
        /\.(?:[cm]?[jt]s|py|rb|sh|bash|ps1)$/i.test(file) &&
        (/(^|\/)(?:scripts?|bin|tools?|ci|dev)\//.test(file) ||
          hs.some((h) => h.shebang));
      if (!isNew || !script || fileRole(file) === 'tests') continue;
      const cli = scriptInterface(hs.flatMap((h) => h.plus ?? []));
      if (cli.length) node('File', file, { cli });
    }
  }
  const hunksByFile = new Map<string, PatchHunk[]>();
  for (const h of hunks) {
    hunksByFile.set(h.file, [...(hunksByFile.get(h.file) ?? []), h]);
    node('Hunk', h.id, {
      file: h.file,
      start: h.start,
      end: h.end,
      added: h.added,
      removed: h.removed,
      diff: h.diff,
      context: h.context ?? null,
      scope: h.scope ?? null,
      symbols: h.symbols,
      touched: h.touched,
      branches: h.branches,
      fresh: h.fresh,
      pairs: h.pairs,
      dropped: h.dropped,
      conds: h.conds,
      tests: h.tests,
      moved: h.moved ?? null,
      owns: h.owns ?? [],
      readers: h.readers ?? [],
      fnLines: h.fnLines ?? [],
      thin: h.thin ?? [],
      types: h.types ?? [],
      fnWords: h.fnWords,
      words: h.words,
      code: h.code,
      binary: h.binary ?? null,
      shebang: h.shebang ?? false,
      localServer: h.localServer ?? false,
      fakes: h.fakes ?? [],
    });
    rel('OF', ['Hunk', h.id], ['File', h.file]);
  }

  // Sessions and their facts.
  const factSession = new Map<object, string>();
  // Per session: each distinct command (at most 40) → its output words.
  const invocationsBy = new Map(
    trails.map((t) => {
      const m = new Map<string, Set<string>>();
      for (const x of t.invocations ?? []) {
        if (!m.has(x.cmd) && m.size >= 40) continue;
        const w = m.get(x.cmd) ?? new Set<string>();
        for (const o of x.out) if (w.size < 40) w.add(o);
        m.set(x.cmd, w);
      }
      return [t.ref, m];
    }),
  );
  // Per session: its last distinct commands in this repository other than
  // checks (at most 12), each with when it last ran.
  const lateBy = new Map(
    trails.map((t) => {
      const m = new Map<string, string>();
      for (const x of t.invocations ?? [])
        if (x.t && !x.elsewhere) {
          m.delete(x.cmd);
          m.set(x.cmd, x.t);
        }
      return [t.ref, [...m].slice(-12)];
    }),
  );
  // Decisions whose every question went unanswered: no node, no relation.
  const droppedDecisions = new Set(
    full.sessions.flatMap((s) =>
      s.decisions.filter((d) => d.id && unansweredDecision(d)).map((d) => d.id!),
    ),
  );
  for (const s of full.sessions) {
    // Failed commands other than checks (checks are Run nodes with outcomes).
    const checkKeys = new Set(
      s.runs
        .filter((r) => r.kind !== 'other')
        .map((r) => clip(commandKey(testSegment(r.cmd) ?? r.cmd), 60)),
    );
    const failing = s.commands.filter(
      (c) => c.failures > 0 && !c.isTest && !c.isCheck && !checkKeys.has(c.cmd),
    );
    node('Session', s.ref, {
      agent: s.agent,
      // Every user prompt in the session log, kept or not (older digests: unknown).
      userPrompts: s.userPrompts?.count ?? null,
      firstPromptT: s.userPrompts?.firstT ?? null,
      band: s.band,
      score: s.score,
      title: s.title ?? null,
      failedCommands: failing.reduce((n, c) => n + c.failures, 0),
      failedCommand: failing[0]?.cmd ?? null,
      failedCmds: failing
        .slice(0, 8)
        .map((c) => `${c.cmd} (failed ${c.failures} of ${c.count})`),
      // Commands other than checks that ran something (as plain words), and
      // (same position) the words of their output the PR's changed lines also contain.
      invoked: [...(invocationsBy.get(s.ref) ?? new Map()).keys()],
      invokedOut: [...(invocationsBy.get(s.ref) ?? new Map()).values()].map((w) =>
        [...w].join(' '),
      ),
      // The last commands other than checks, and (same position) when each last ran.
      lateCmds: (lateBy.get(s.ref) ?? []).map(([c]) => c),
      lateT: (lateBy.get(s.ref) ?? []).map(([, t]) => t),
      // Pushes, PRs made and looks at CI (same position: kind, time, failed).
      remoteCmds: (s.remote ?? []).map((x) => x.cmd),
      remoteKinds: (s.remote ?? []).map((x) => x.kind),
      remoteT: (s.remote ?? []).map((x) => x.t ?? ''),
      remoteFailed: (s.remote ?? []).map((x) => (x.failed ? 'failed' : 'ok')),
      remoteResults: (s.remote ?? []).map((x) =>
        x.results ? ['results', ...(x.heads ?? [])].join(' ') : '',
      ),
      // Same position: runner platforms of jobs the CI look shows passing.
      remoteOs: (s.remote ?? []).map((x) => (x.os ?? []).join(' ')),
      // Same position: platforms of jobs shown finished (passed or failed).
      remoteRanOs: (s.remote ?? []).map((x) => (x.ranOs ?? x.os ?? []).join(' ')),
      // Same position: workflow files the CI command ran or watched.
      remoteWorkflows: (s.remote ?? []).map((x) => (x.workflows ?? []).join(' ')),
      // Same position: `commit` when the push's command line committed first.
      remoteWith: (s.remote ?? []).map((x) => (x.withCommit ? 'commit' : '')),
    });
    for (const p of s.prompts) factSession.set(p, s.ref);
    for (const p of s.prompts)
      if (p.id)
        node('Prompt', p.id, {
          t: p.t ?? null,
          text: clip(p.text.replace(/\s+/g, ' '), 1500),
          pushback: !!p.pushback,
          ledToEdits: p.ledToEdits,
          session: s.ref,
        });
    for (const d of s.decisions)
      if (d.id && !unansweredDecision(d))
        node('Decision', d.id, {
          t: d.t ?? null,
          text: clip(d.text.replace(/\s+/g, ' '), 600),
          answers: decisionAnswers(d),
          // The record itself was cut off (not this clip): its answer may be incomplete.
          truncated:
            RECORD_TRUNCATED.test(d.text) ||
            (d.questions ?? []).some((q) => RECORD_TRUNCATED.test(q.answer ?? '')),
          session: s.ref,
        });
    for (const p of s.plans)
      if (p.id)
        node('Plan', p.id, {
          t: p.t ?? null,
          approved: p.approved ?? null,
          text: clip(firstLine(p.excerpt), 120),
          // Headings kept: the brief quotes the why-sections first (queries.ts planText).
          excerpt: clip(p.excerpt.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n'), 1500),
          session: s.ref,
        });
    for (const r of s.runs)
      if (r.id)
        node('Run', r.id, {
          t: r.t ?? null,
          cmd: clip(r.cmd, 120),
          kind: r.kind,
          outcome: r.outcome,
          revision: r.revision,
          summary: r.summary.slice(0, 3),
          when: RUN_WHEN[r.revision] ?? r.revision,
          session: s.ref,
          basis: r.basis,
          statable: r.statable === true,
          masked: r.masked ?? null,
        });
    for (const label of ['Prompt', 'Decision', 'Plan', 'Run'] as const) {
      const facts =
        label === 'Prompt'
          ? s.prompts
          : label === 'Decision'
            ? s.decisions
            : label === 'Plan'
              ? s.plans
              : s.runs;
      for (const f of facts)
        if (f.id && !(label === 'Decision' && droppedDecisions.has(f.id)))
          rel('IN_SESSION', [label, f.id], ['Session', s.ref]);
    }
    for (const sha of s.commitsMade) {
      const c = full.pr.commits.find(
        (x) => x.sha.startsWith(sha) || sha.startsWith(x.sha),
      );
      if (c) rel('MADE', ['Session', s.ref], ['Commit', c.sha.slice(0, 12)]);
    }
  }
  for (const r of full.verification ?? [])
    if (r.id)
      node('Receipt', r.id, {
        cmd: clip(r.cmd, 120),
        kind: r.kind,
        outcome: r.outcome,
        summary: r.summary.slice(0, 3),
        when: r.environmentChanged
          ? 'fresh: run on the submitted content, in a different shell environment than this one'
          : 'fresh: run on the submitted content',
      });

  // Commits, the files they touched, the hunks their own lines survive in, and
  // their messages split into sentences that can each be attributed on their own.
  const hunkCommits = new Map<string, Map<string, number>>();
  const lookup = <T>(m: Map<string, T> | undefined, sha: string): T | undefined =>
    m?.get(sha) ??
    [...(m?.entries() ?? [])].find(([k]) => k.startsWith(sha.slice(0, 12)))?.[1];
  for (const c of full.pr.commits) {
    const sha = c.sha.slice(0, 12);
    const own = lookup(input.commitLines, c.sha);
    node('Commit', sha, {
      subject: clip(c.subject, 120),
      // The message body often holds the motivation; keep it queryable.
      body: c.body ? clip(c.body, 4000) : null,
      t: c.time ?? null,
      // Only comments, docs or tests changed: the commit changes no behavior.
      noBehavior: own ? commentOrTestOnly(own) : false,
    });
    for (const path of lookup(input.commitFiles, c.sha) ?? []) {
      if (!prFiles.has(path)) continue;
      rel('TOUCHES', ['Commit', sha], ['File', path]);
      // A binary file has no lines to match: the commits that touched it introduced it.
      for (const h of hunksByFile.get(path) ?? [])
        if (h.binary) {
          rel('INTRODUCED', ['Commit', sha], ['Hunk', h.id], { lines: 1 });
          const m = hunkCommits.get(h.id) ?? new Map<string, number>();
          m.set(sha, (m.get(sha) ?? 0) + 1);
          hunkCommits.set(h.id, m);
        }
    }
    for (const [path, added] of lookup(input.commitLines, c.sha) ?? []) {
      const set = new Set(added);
      for (const h of hunksByFile.get(path) ?? []) {
        let n = 0;
        for (const l of h.lines) if (set.has(l)) n++;
        for (const l of h.gone) if (set.has(`-${l}`)) n++;
        if (n) {
          rel('INTRODUCED', ['Commit', sha], ['Hunk', h.id], { lines: n });
          const m = hunkCommits.get(h.id) ?? new Map<string, number>();
          m.set(sha, (m.get(sha) ?? 0) + n);
          hunkCommits.set(h.id, m);
        }
      }
    }
    commitSentences(c.body ?? '').forEach((text, i) => {
      const id = `${sha}#${i + 1}`;
      node('CommitClaim', id, {
        commit: sha,
        text: clip(text, 400),
        assertsResult: RESULT_CLAIM.test(text),
      });
      rel('SAYS', ['Commit', sha], ['CommitClaim', id]);
    });
  }
  // Requests typed in an included session between the previous commit and this
  // one: what the user asked for while this commit's change was being made, even
  // when no captured edit links them (shell edits, edits by another tool).
  const included = full.sessions.filter((s) => s.band === 'included');
  const timed = full.pr.commits
    .filter((c) => c.time)
    .sort((a, b) => a.time!.localeCompare(b.time!));
  timed.forEach((c, i) => {
    const after = i ? timed[i - 1]!.time! : '';
    for (const s of included) {
      if (s.span.start && s.span.start > c.time!) continue;
      for (const p of s.prompts)
        if (p.id && p.t && p.t > after && p.t <= c.time!)
          rel('ASKED_BEFORE', ['Prompt', p.id], ['Commit', c.sha.slice(0, 12)]);
    }
  });

  // Walk each session's trail: turns, edits, survival and later edits.
  let editN = 0;
  let deadEnds = 0;
  const band = new Map(full.sessions.map((s) => [s.ref, s.band]));
  /** Hunk → prompt → surviving lines, from included sessions only. */
  const hunkPrompts = new Map<string, Map<string, number>>();
  /** File → prompts of included turns that edited it at all (surviving or not). */
  const fileTurns = new Map<string, Set<string>>();
  const linked = new Set<string>();
  for (const trail of trails) {
    let turn: string | undefined;
    let previousPrompt: string | undefined;
    const openRuns: { id: string; t?: string }[] = [];
    for (const e of trail.events) {
      if (e.kind === 'prompt') {
        const id = e.fact.id;
        if (!id) continue;
        if (previousPrompt && previousPrompt !== id)
          rel('NEXT', ['Prompt', previousPrompt], ['Prompt', id]);
        previousPrompt = turn = id;
        continue;
      }
      if (e.kind !== 'edit') {
        const id = e.fact.id;
        if (!id) continue;
        if (e.kind === 'decision' && droppedDecisions.has(id)) continue;
        const label =
          e.kind === 'decision' ? 'Decision' : e.kind === 'plan' ? 'Plan' : 'Run';
        if (turn) rel('IN_TURN', [label, id], ['Prompt', turn]);
        if (e.kind === 'run') openRuns.push({ id, t: e.fact.t });
        continue;
      }
      const id = `E${++editN}`;
      let surviving = 0;
      const into: [string, number][] = [];
      for (const h of hunksByFile.get(e.file) ?? []) {
        const n = e.lines.filter((l) => h.lines.has(l)).length;
        if (n) {
          into.push([h.id, n]);
          surviving += n;
        }
      }
      // A write read from a command's text has no lines to survive.
      if (!surviving && !e.inferred) deadEnds++;
      node('Edit', id, {
        t: e.t ?? null,
        file: e.file,
        added: e.added,
        removed: e.removed,
        surviving,
        inPr: e.inPr,
        via: e.via ?? null,
        inferred: e.inferred === true,
        session: trail.ref,
      });
      if (!nodes.has(`File|${e.file}`))
        node('File', e.file, {
          role: fileRole(e.file),
          inPr: false,
          added: 0,
          removed: 0,
          unmatched: 0,
        });
      rel('EDITS', ['Edit', id], ['File', e.file]);
      rel('IN_SESSION', ['Edit', id], ['Session', trail.ref]);
      if (turn) rel('IN_TURN', ['Edit', id], ['Prompt', turn]);
      for (const [h, n] of into) {
        rel('SURVIVES_IN', ['Edit', id], ['Hunk', h], { lines: n });
        linked.add(h);
        if (turn && band.get(trail.ref) === 'included') {
          const m = hunkPrompts.get(h) ?? new Map<string, number>();
          m.set(turn, (m.get(turn) ?? 0) + n);
          hunkPrompts.set(h, m);
        }
      }
      if (turn && e.inPr && band.get(trail.ref) === 'included')
        fileTurns.set(e.file, (fileTurns.get(e.file) ?? new Set()).add(turn));
      // Every earlier run in this session did not see this edit to a PR file. A
      // shell edit made by the run's own command (sed … && prettier --check)
      // shares its timestamp and can't be ordered against it; it is not later.
      if (e.inPr)
        for (const r of openRuns)
          if (!(e.via === 'shell' && r.t && r.t === e.t))
            rel('LATER_EDIT', ['Run', r.id], ['File', e.file]);
    }
  }

  // Change units: the hunks that belong to one idea. Commits are the author's own
  // grouping, so with several commits a hunk joins the commit whose lines it
  // holds most; otherwise the request turn whose edits it holds most; otherwise
  // its directory. Ordered behavior first, by size.
  const top = (m: Map<string, number> | undefined) =>
    m && [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const committing = new Set([...hunkCommits.values()].flatMap((m) => [...m.keys()]));
  const groups = new Map<string, PatchHunk[]>();
  for (const h of hunks) {
    const commit = committing.size > 1 ? top(hunkCommits.get(h.id)) : undefined;
    const prompt = top(hunkPrompts.get(h.id));
    const key = commit
      ? `commit:${commit}`
      : prompt
        ? `prompt:${prompt}`
        : `dir:${dirOf(h.file)}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  const roleOf = (f: string) => String(nodes.get(`File|${f}`)?.props.role ?? 'other');
  // One commit and one request can still hold several ideas. A group with many
  // behavior files splits by module; its tests, docs and version files form one
  // supporting change, so behavior is described apart from bookkeeping.
  const MAX_BEHAVIOR_FILES = 4;
  for (const [key, hs] of [...groups]) {
    const behaviorFiles = new Set(
      hs.filter((h) => roleOf(h.file) === 'behavior').map((h) => h.file),
    );
    if (behaviorFiles.size <= MAX_BEHAVIOR_FILES) continue;
    groups.delete(key);
    for (const h of hs) {
      const sub =
        roleOf(h.file) === 'behavior' ? `${key}|${dirOf(h.file)}` : `${key}|supporting`;
      groups.set(sub, [...(groups.get(sub) ?? []), h]);
    }
  }
  splitScriptUnits(groups, roleOf);
  splitWorkflowUnits(groups);
  foldStrayLines(groups);
  const weight = (hs: PatchHunk[]) =>
    hs
      .filter((h) => roleOf(h.file) === 'behavior')
      .reduce((a, h) => a + h.added + h.removed, 0);
  const ordered = [...groups.entries()].sort(
    (a, b) =>
      weight(b[1]) - weight(a[1]) ||
      b[1].reduce((n, h) => n + h.added, 0) - a[1].reduce((n, h) => n + h.added, 0) ||
      a[0].localeCompare(b[0]),
  );
  ordered.forEach(([key, hs], i) => {
    const id = `CH${i + 1}`;
    const files = [...new Set(hs.map((h) => h.file))];
    const roles = [...new Set(files.map(roleOf))].sort();
    const symbols = [...new Set(hs.flatMap((h) => h.touched))].slice(0, 16);
    node('Change', id, {
      key,
      files,
      roles,
      symbols,
      added: hs.reduce((n, h) => n + h.added, 0),
      removed: hs.reduce((n, h) => n + h.removed, 0),
      branches: hs.reduce((n, h) => n + h.branches, 0),
    });
    const commits = new Set<string>();
    const asked = new Map<string, string>();
    for (const h of hs) {
      rel('HAS', ['Change', id], ['Hunk', h.id]);
      for (const c of hunkCommits.get(h.id)?.keys() ?? []) commits.add(c);
      for (const p of hunkPrompts.get(h.id)?.keys() ?? [])
        asked.set(p, 'its edits survive here');
    }
    for (const c of commits) rel('EXPLAINED_BY', ['Change', id], ['Commit', c]);
    // Weaker links only when nothing survives line for line.
    if (!asked.size)
      for (const f of files)
        for (const p of fileTurns.get(f) ?? [])
          asked.set(p, 'its turn edited these files');
    if (!asked.size)
      for (const r of rels)
        if (r.type === 'ASKED_BEFORE' && commits.has(r.to.id))
          asked.set(r.from.id, 'typed before the commit that made it');
    for (const [p, how] of asked) rel('ASKED_BY', ['Change', id], ['Prompt', p], { how });
  });

  const sorted = [...nodes.values()];
  return {
    schema: GRAPH_SCHEMA,
    nodes: sorted,
    rels,
    stats: {
      nodes: sorted.length,
      rels: rels.length,
      hunks: hunks.length,
      linkedHunks: linked.size,
      edits: editN,
      deadEndEdits: deadEnds,
      changes: ordered.length,
    },
  };
}
