/**
 * Splits a shell command line into the commands it runs (`a && b; c | d`),
 * leaving quoted strings and heredoc bodies alone. Agents often run scripts
 * inline (`python -c "..."`, `cat <<'EOF' ... EOF`), and a line inside one is
 * text, not a command: `print('bun test')` must not count as a test run.
 */
export interface ShellSegment {
  command: string;
  before?: '&&' | '||' | ';' | '|' | '\n';
}

export function shellSegments(cmd: string): ShellSegment[] {
  const parts: ShellSegment[] = [];
  let before: ShellSegment['before'];
  let cur = '';
  let quote: '"' | "'" | '`' | undefined;
  // A heredoc's body starts at the end of its line; skip from there to here.
  let bodyAt = -1;
  let bodyEnd = -1;
  const push = (next: ShellSegment['before']) => {
    if (cur.trim()) parts.push({ command: cur.trim(), before });
    cur = '';
    before = next;
  };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (quote) {
      if (quote === '"' && ch === '`' && /["'$`]/.test(cmd[i + 1] ?? '')) {
        cur += ch + cmd[++i];
        continue;
      }
      if (ch === '\\' && quote !== "'" && i + 1 < cmd.length) {
        cur += ch + cmd[++i];
        continue;
      }
      if (ch === quote) quote = undefined;
      cur += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < cmd.length) {
      cur += ch + cmd[++i];
      continue;
    }
    // PowerShell here-strings contain literal script/file text, including quotes.
    // Their contents are not shell commands, even when piped to an interpreter.
    const psHere = /^@(['"])\r?\n/.exec(cmd.slice(i));
    if (psHere) {
      const rest = cmd.slice(i + psHere[0].length);
      const end = new RegExp(`(?:^|\\n)[\\t ]*${psHere[1]}@`).exec(rest);
      const length = end ? psHere[0].length + end.index + end[0].length : cmd.length - i;
      cur += cmd.slice(i, i + length);
      i += length - 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    const here =
      bodyAt < 0 ? /^<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(cmd.slice(i)) : null;
    if (here) {
      cur += here[0];
      i += here[0].length - 1;
      const start = cmd.indexOf('\n', i + 1);
      if (start >= 0) {
        const end = new RegExp(`\\n[\\t ]*${here[2]}[\\t ]*(?=\\n|$)`).exec(
          cmd.slice(start),
        );
        bodyAt = start;
        bodyEnd = end ? start + end.index + end[0].length : cmd.length;
      }
      continue;
    }
    if (ch === '\n' && i === bodyAt) {
      push('\n');
      i = bodyEnd - 1;
      bodyAt = -1;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      push(two as '&&' | '||');
      i++;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '\n') {
      push(ch as ';' | '|' | '\n');
      continue;
    }
    cur += ch;
  }
  push(undefined);
  return parts;
}

export function splitCommands(cmd: string): string[] {
  return shellSegments(cmd).map((part) => part.command);
}

/** A quoted shell word at the start of `s`: its text with quotes and escapes undone, and its length. */
function quotedWord(s: string): { text: string; length: number } | undefined {
  const q = s[0];
  if (q === "'") {
    const end = s.indexOf("'", 1);
    return end < 0 ? undefined : { text: s.slice(1, end), length: end + 1 };
  }
  if (q === '"') {
    let text = '';
    for (let i = 1; i < s.length; i++) {
      const ch = s[i]!;
      if (ch === '\\' && i + 1 < s.length && /["\\$`\n]/.test(s[i + 1]!)) {
        text += s[++i];
        continue;
      }
      if (ch === '"') return { text, length: i + 1 };
      text += ch;
    }
    return undefined;
  }
  const m = /^[^\s;&|]+/.exec(s);
  return m ? { text: m[0], length: m[0].length } : undefined;
}

/**
 * The command a wrapper runs, when a segment is one: `docker run … -c '<cmd>'`
 * (also podman, `docker exec`, `docker compose run`), `sh -c '<cmd>'` (bash,
 * zsh, dash, with flags such as `-lc`, `-xc`), `xvfb-run [-a] <cmd>`,
 * `timeout <duration> <cmd>`. Undefined for any other segment.
 */
export function wrappedCommand(segment: string): string | undefined {
  const seg = segment.trim();
  const container = /^(?:docker|podman)\s+(?:run|exec|compose\s+run)\b/.test(seg);
  if (container || /^(?:\/(?:usr\/)?bin\/)?(?:ba|z|da)?sh\s/.test(seg)) {
    // The script after the shell's `-c` (or a flag group ending in it).
    const m = /\s-[A-Za-z]*c\s+(?=['"]|[^\s-])/.exec(seg);
    if (!m) return undefined;
    // For a shell itself, `-c` must belong to it, not to a later program.
    if (
      !container &&
      !/^(?:\/(?:usr\/)?bin\/)?(?:ba|z|da)?sh(?:\s+-[A-Za-z]+)*\s+-[A-Za-z]*c\s/.test(seg)
    )
      return undefined;
    const w = quotedWord(seg.slice(m.index + m[0].length));
    return w?.text.trim() || undefined;
  }
  const xvfb =
    /^xvfb-run\s+((?:(?:-a|--auto-servernum|-f\s+\S+|-n\s+\d+|-s\s+(?:'[^']*'|"[^"]*"|\S+)|--[\w-]+=(?:'[^']*'|"[^"]*"|\S+))\s+)*)(.+)$/s.exec(
      seg,
    );
  if (xvfb) return xvfb[2]!.trim();
  const timeout =
    /^timeout\s+(?:-[\w-]+(?:=\S+)?\s+|-[ks]\s+\S+\s+)*\d+[smhd]?\s+(.+)$/s.exec(seg);
  if (timeout) return timeout[1]!.trim();
  return undefined;
}

/**
 * Shell segments with wrappers opened: a wrapper's segment is replaced by the
 * segments of the command it runs (recursively), the first of them taking the
 * wrapper's separator. Each keeps the command text it was split from.
 */
export function openSegments(
  cmd: string,
  depth = 0,
): (ShellSegment & { from: string })[] {
  return shellSegments(cmd).flatMap((s) => {
    const inner = depth < 4 ? wrappedCommand(s.command) : undefined;
    if (!inner) return [{ ...s, from: cmd }];
    const parts = openSegments(inner, depth + 1);
    if (!parts.length) return [{ ...s, from: cmd }];
    parts[0] = { ...parts[0]!, before: s.before };
    return parts;
  });
}
