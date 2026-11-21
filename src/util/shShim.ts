/**
 * Tracetoon's `sh` shim, for Windows machines without Git for Windows. Goose
 * starts every plugin hook as `sh -c "<command>"`; `tracetoon setup --agent
 * goose --fix-sh` hard-links tracetoon.exe as sh.exe in its own folder on the
 * user PATH (src/integrations/goose/shell.ts). Started under that name, the
 * runtime only reads `-c <command>` and runs the Tracetoon program the command
 * names; it never interprets shell syntax. Anything else goes to Git's sh when
 * there is one, or fails with 127 ("command not found"), as sh would.
 *
 * The named program is started as its own process rather than run in this
 * one, so an old shim left behind by `update` still runs the current binary,
 * and nothing in the hook sees sh.exe as Tracetoon's own path.
 */
import { spawnSync } from 'node:child_process';

/** The last part of a Windows or POSIX path. */
const lastPart = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** This process was started as the shim. */
export const isShim = (execPath = process.execPath) =>
  /^sh(?:\.exe)?$/i.test(lastPart(execPath));

/**
 * Split `sh -c` text into words: whitespace separates, '…' is literal, "…"
 * allows \" and \\, and a backslash outside quotes escapes the next character.
 * Returns undefined for anything with shell syntax the shim won't run.
 */
export function shellWords(text: string): string[] | undefined {
  const words: string[] = [];
  let word = '';
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return undefined;
      word += text.slice(i + 1, end);
      inWord = true;
      i = end;
    } else if (c === '"') {
      i++;
      for (; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === '\\' && /["\\$`]/.test(text[i + 1] ?? '')) i++;
        else if (/[$`]/.test(text[i]!)) return undefined;
        word += text[i];
      }
      if (i >= text.length) return undefined;
      inWord = true;
    } else if (c === '\\') {
      if (i + 1 >= text.length) return undefined;
      word += text[++i];
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
    } else if (/[;&|<>()$`*?~{}#]/.test(c)) {
      return undefined; // pipes, redirection, expansion: real shell work
    } else {
      word += c;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  return words;
}

const TRACETOON = /^tracetoon(?:\.exe)?$/i;

export type ShimPlan =
  | { kind: 'run'; program: string; args: string[] }
  | { kind: 'delegate'; sh: string; args: string[] }
  | { kind: 'reject'; message: string };

/** What the shim does with its arguments (argv after the program). */
export function shimPlan(args: string[], gitSh: string | undefined): ShimPlan {
  const text = args[0] === '-c' && args.length >= 2 ? args[1]! : undefined;
  const words = text === undefined ? undefined : shellWords(text);
  const program = words?.[0];
  if (words && program && TRACETOON.test(lastPart(program)))
    return { kind: 'run', program, args: words.slice(1) };
  if (gitSh) return { kind: 'delegate', sh: gitSh, args };
  return {
    kind: 'reject',
    message:
      'tracetoon sh shim: only runs Tracetoon hook commands (`sh -c "tracetoon.exe hook …"`); install Git for Windows for a full sh.\n',
  };
}

/** Run as the shim; returns the exit code. */
export function shimMain(args: string[], gitSh: () => string | undefined): number {
  let plan = shimPlan(args, undefined);
  if (plan.kind === 'reject') plan = shimPlan(args, gitSh()); // look for Git only when needed
  if (plan.kind === 'reject') {
    process.stderr.write(plan.message);
    return 127;
  }
  const [program, rest] =
    plan.kind === 'run' ? [plan.program, plan.args] : [plan.sh, plan.args];
  const r = spawnSync(program, rest, { stdio: 'inherit', windowsHide: true });
  if (r.error) {
    process.stderr.write(`sh: ${program}: ${r.error.message}\n`);
    return 127;
  }
  return r.status ?? 1;
}
