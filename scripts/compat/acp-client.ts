/**
 * A minimal Agent Client Protocol client that starts an agent adapter the way
 * Zed does (a child process speaking newline-delimited JSON-RPC on stdio) and
 * sends it one prompt. Zed's external agents (Claude Code, Codex) run through
 * these adapters, so this exercises the same path without Zed's interface.
 *
 *   bun scripts/compat/acp-client.ts --cwd <repo> --prompt <text> -- <command> [args...]
 *
 * Permission requests are answered "allow", as a user clicking through would.
 * The client offers no file system or terminal of its own, so the agent uses
 * its built-in tools. Exits 0 when the prompt turn ends, 1 on a protocol error.
 */
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

type Json = Record<string, any>;

const split = process.argv.indexOf('--');
const { values } = parseArgs({
  args: process.argv.slice(2, split < 0 ? undefined : split),
  options: { cwd: { type: 'string' }, prompt: { type: 'string' } },
});
const command = split < 0 ? [] : process.argv.slice(split + 1);
if (!values.cwd || !values.prompt || !command.length) {
  console.error(
    'usage: acp-client.ts --cwd <dir> --prompt <text> -- <command> [args...]',
  );
  process.exit(2);
}

const child = spawn(command[0]!, command.slice(1), {
  cwd: values.cwd,
  stdio: ['pipe', 'pipe', 'inherit'],
  shell: process.platform === 'win32',
  windowsHide: true,
});

let nextId = 1;
const pending = new Map<number, { ok: (v: Json) => void; fail: (e: Error) => void }>();
const send = (msg: Json) =>
  child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

function request(method: string, params: Json): Promise<Json> {
  const id = nextId++;
  send({ id, method, params });
  return new Promise((ok, fail) => pending.set(id, { ok, fail }));
}

/** The agent asking the client something: allow every permission, refuse the rest. */
function answer(msg: Json) {
  if (msg.method === 'session/request_permission') {
    const options: Json[] = msg.params?.options ?? [];
    const allow =
      options.find((o) => o.kind === 'allow_always') ??
      options.find((o) => o.kind === 'allow_once') ??
      options[0];
    send({
      id: msg.id,
      result: { outcome: { outcome: 'selected', optionId: allow?.optionId } },
    });
    return;
  }
  send({
    id: msg.id,
    error: { code: -32601, message: `client does not support ${msg.method}` },
  });
}

let buf = '';
child.stdout!.on('data', (chunk) => {
  buf += chunk;
  let nl: number;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg: Json;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // log noise on stdout
    }
    if (msg.id !== undefined && msg.method) answer(msg);
    else if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p?.fail(new Error(`${msg.error.code}: ${msg.error.message}`));
      else p?.ok(msg.result ?? {});
    } else if (msg.method === 'session/update') {
      const u = msg.params?.update;
      if (u?.sessionUpdate === 'tool_call')
        console.log(`tool: ${u.title ?? u.kind ?? ''}`);
      if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.text)
        process.stdout.write(u.content.text);
    }
  }
});
child.on('exit', (code) => {
  for (const p of pending.values()) p.fail(new Error(`adapter exited (${code})`));
});

try {
  const init = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
    clientInfo: { name: 'tracetoon-compat', version: '1' },
  });
  let session: Json;
  try {
    session = await request('session/new', { cwd: values.cwd, mcpServers: [] });
  } catch (e) {
    // Some adapters want an explicit sign-in choice first: pick the API-key one.
    const method = (init.authMethods ?? []).find((m: Json) =>
      /key|env/i.test(`${m.id} ${m.name}`),
    );
    if (!method) throw e;
    await request('authenticate', { methodId: method.id });
    session = await request('session/new', { cwd: values.cwd, mcpServers: [] });
  }
  // Pick the adapter's most permissive mode, as a user who trusts the
  // workspace would in Zed; otherwise Codex sends every command to its own
  // review model first. Hooks run the same in every mode.
  const modes: Json[] = session.modes?.availableModes ?? [];
  const open = modes.find((m) =>
    /full|bypass|yolo|danger|agent-full/i.test(`${m.id} ${m.name}`),
  );
  if (open && open.id !== session.modes?.currentModeId)
    await request('session/set_mode', {
      sessionId: session.sessionId,
      modeId: open.id,
    }).catch(() => undefined);
  const result = await request('session/prompt', {
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: values.prompt }],
  });
  console.log(`\nstop: ${result.stopReason}`);
  child.stdin!.end();
  child.kill();
  process.exit(0);
} catch (e) {
  console.error(`acp: ${(e as Error).message}`);
  child.kill();
  process.exit(1);
}
