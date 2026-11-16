/**
 * A scripted model server for compatibility runs. The released agent talks to
 * it as if it were a model provider, so the agent's own code (tools, hooks,
 * session logs) runs for real, while no model provider is called and nothing
 * costs money.
 *
 * It speaks Anthropic Messages, OpenAI Chat Completions and the OpenAI
 * Responses API, streaming or not. Every conversation follows one script, and
 * the step is taken from how many tool calls the conversation already holds:
 *
 *   0. write compat.txt with the agent's file-writing tool
 *   1. run `git status --short` (an ordinary command, which must run)
 *   2. run `gh pr create ...` (Tracetoon's hook must stop it)
 *   3. say "done"
 *
 * Requests without tools (titles, summaries, quota probes) get a short text
 * reply. Tool and argument names come from the tools the agent sent, so one
 * script serves every agent. Every request and every tool result the agent
 * returns is appended to FAKE_LLM_LOG for the harness to check.
 *
 *   bun scripts/compat/fake-llm.ts            prints {"port": N} once listening
 */
import { appendFileSync } from 'node:fs';

type Json = Record<string, any>;

/** The file the script writes; the harness looks for an edit to it. */
export const COMPAT_FILE = 'compat.txt';
export const COMPAT_TEXT = 'written by the tracetoon compatibility check\n';
export const ORDINARY_COMMAND = 'git status --short';
export const PR_COMMAND =
  'gh pr create --title "Compat check" --body "Opened by the compatibility check"';

/** A tool as the agent described it, whatever the wire format. */
export interface ToolSpec {
  name: string;
  /** JSON Schema of the arguments; undefined for freeform (custom) tools. */
  schema?: Json;
  freeform?: boolean;
  description?: string;
}

/** One step's tool call, ready for any wire format. */
export interface PlannedCall {
  name: string;
  /** JSON arguments, or the raw input of a freeform tool. */
  args: Json | string;
  freeform?: boolean;
}

const props = (t: ToolSpec): Record<string, Json> => t.schema?.properties ?? {};
const prop = (t: ToolSpec, re: RegExp) => Object.keys(props(t)).find((k) => re.test(k));

/** The tool that writes a whole file, and its path and content arguments. */
function writeTool(tools: ToolSpec[]): PlannedCall | undefined {
  const byName =
    /^(write|write_file|writefile|create_file|fs_write|edit_file|str_replace_based_edit_tool)$/i;
  const candidates = [
    ...tools.filter((t) => byName.test(t.name)),
    ...tools.filter((t) => !byName.test(t.name) && /write|create/i.test(t.name)),
  ];
  for (const t of candidates) {
    const path = prop(t, /^(file_?path|path|filename|target_file|absolute_path)$/i);
    const content = prop(t, /^(content|contents|text|file_text)$/i);
    if (!path || !content) continue;
    const args: Json = { [path]: COMPAT_FILE, [content]: COMPAT_TEXT };
    // Some write tools take a command discriminator (str_replace_based_edit_tool).
    const command = prop(t, /^command$/i);
    if (command) args[command] = 'create';
    return { name: t.name, args };
  }
  // Codex edits through apply_patch, a freeform tool or a JSON one with `input`.
  const patch = tools.find((t) => t.name === 'apply_patch');
  if (patch)
    return patch.freeform
      ? { name: patch.name, args: PATCH, freeform: true }
      : { name: patch.name, args: { [prop(patch, /input|patch/i) ?? 'input']: PATCH } };
  return undefined;
}

/** The tool that runs a shell command, with `command` filled in its own shape. */
function shellTool(tools: ToolSpec[], command: string): PlannedCall | undefined {
  const byName =
    /^(bash|shell|powershell|run_shell_command|run_terminal_cmd|exec_command|execute_bash|execute_pwsh|terminal|run_command|local_shell|shell_command)$/i;
  for (const t of tools.filter((t) => byName.test(t.name))) {
    if (t.freeform) return { name: t.name, args: command, freeform: true };
    const key = prop(t, /^(command|cmd|commandline|command_line)$/i);
    if (!key) continue;
    const shape = props(t)[key];
    const args: Json = {
      [key]:
        shape?.type === 'array'
          ? process.platform === 'win32'
            ? ['powershell', '-NoProfile', '-Command', command]
            : ['bash', '-lc', command]
          : command,
    };
    // Tools that ask why a command runs (OpenCode's bash) get a reason.
    const why = prop(t, /^description$/i);
    if (why && props(t)[why]) args[why] = 'compatibility check';
    return { name: t.name, args };
  }
  return undefined;
}

const PATCH = `*** Begin Patch\n*** Add File: ${COMPAT_FILE}\n+${COMPAT_TEXT.trimEnd()}\n*** End Patch\n`;

/**
 * Codex's code mode: one freeform `exec` tool that runs JavaScript, with the
 * real tools (apply_patch, exec_command) reached as `tools.<name>(...)`.
 */
function codeMode(step: number, tools: ToolSpec[]): PlannedCall | undefined {
  const exec = tools.find(
    (t) => t.name === 'exec' && t.freeform && /tools\.\w+\(/.test(t.description ?? ''),
  );
  if (!exec) return undefined;
  const show = 'text(typeof r === "string" ? r : JSON.stringify(r));';
  const run = (cmd: string) =>
    `const r = await tools.exec_command({ cmd: ${JSON.stringify(cmd)} });\n${show}`;
  const js =
    step === 0
      ? `const r = await tools.apply_patch(${JSON.stringify(PATCH)});\n${show}`
      : step === 1
        ? run(ORDINARY_COMMAND)
        : run(PR_COMMAND);
  return { name: exec.name, args: js, freeform: true };
}

/** The call for a step, or undefined for "reply with text". */
export function plan(step: number, tools: ToolSpec[]): PlannedCall | undefined {
  if (step > 2) return undefined;
  const code = codeMode(step, tools);
  if (code) return code;
  if (step === 0) return writeTool(tools);
  if (step === 1) return shellTool(tools, ORDINARY_COMMAND);
  if (step === 2) return shellTool(tools, PR_COMMAND);
  return undefined;
}

// ---------------------------------------------------------------------------
// Wire formats: read tools, count earlier calls, collect tool results.
// ---------------------------------------------------------------------------

const text = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .map((c) =>
            typeof c === 'string' ? c : (c?.text ?? c?.output ?? text(c?.content)),
          )
          .join('\n')
      : '';

interface Conversation {
  tools: ToolSpec[];
  /** Tool calls the model already made in this conversation. */
  calls: number;
  /** The tool results the agent sent back, oldest first. */
  results: string[];
}

function anthropic(body: Json): Conversation {
  const tools = (body.tools ?? [])
    .filter((t: Json) => t.name)
    .map((t: Json) => ({ name: t.name, schema: t.input_schema }));
  let calls = 0;
  const results: string[] = [];
  for (const m of body.messages ?? [])
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (m.role === 'assistant' && c.type === 'tool_use') calls++;
      if (c.type === 'tool_result') results.push(text(c.content));
    }
  return { tools, calls, results };
}

function chat(body: Json): Conversation {
  const tools = (body.tools ?? [])
    .filter((t: Json) => t.function?.name)
    .map((t: Json) => ({ name: t.function.name, schema: t.function.parameters }));
  let calls = 0;
  const results: string[] = [];
  for (const m of body.messages ?? []) {
    if (m.role === 'assistant') calls += m.tool_calls?.length ?? 0;
    if (m.role === 'tool') results.push(text(m.content));
  }
  return { tools, calls, results };
}

function responsesTool(t: Json): ToolSpec[] {
  // Newer Codex groups tools into namespaces.
  if (t.type === 'namespace') return (t.tools ?? []).flatMap(responsesTool);
  if (t.type === 'function' && t.name)
    return [{ name: t.name, schema: t.parameters, description: t.description }];
  if (t.type === 'custom' && t.name)
    return [{ name: t.name, freeform: true, description: t.description }];
  if (t.type === 'local_shell')
    return [
      { name: 'local_shell', schema: { properties: { command: { type: 'array' } } } },
    ];
  return [];
}

function responses(body: Json): Conversation {
  const input: Json[] = Array.isArray(body.input) ? body.input : [];
  // Codex 0.16x sends its tools as an `additional_tools` input item, not in `tools`.
  const tools = [
    ...(body.tools ?? []),
    ...input.filter((i) => i.type === 'additional_tools').flatMap((i) => i.tools ?? []),
  ].flatMap(responsesTool);
  let calls = 0;
  const results: string[] = [];
  for (const item of input) {
    if (/^(function_call|custom_tool_call|local_shell_call)$/.test(item.type)) calls++;
    if (/_output$/.test(item.type ?? '')) results.push(text(item.output));
  }
  return { tools, calls, results };
}

// ---------------------------------------------------------------------------
// Replies.
// ---------------------------------------------------------------------------

let seq = 0;
const id = (prefix: string) => `${prefix}_compat${(++seq).toString().padStart(6, '0')}`;
const DONE = 'done';
const SIDE_REPLY = 'Compatibility check';

function sse(events: [string | undefined, Json | string][]): Response {
  const body = events
    .map(
      ([event, data]) =>
        `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`,
    )
    .join('');
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  });
}

function anthropicReply(
  body: Json,
  call: PlannedCall | undefined,
  reply: string,
): Response {
  const usage = { input_tokens: 10, output_tokens: 5 };
  const block = call
    ? { type: 'tool_use', id: id('toolu'), name: call.name, input: call.args }
    : { type: 'text', text: reply };
  const message = {
    id: id('msg'),
    type: 'message',
    role: 'assistant',
    model: body.model ?? 'fake',
    content: [block],
    stop_reason: call ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage,
  };
  if (!body.stream) return Response.json(message);
  const start =
    block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' };
  const delta =
    block.type === 'tool_use'
      ? { type: 'input_json_delta', partial_json: JSON.stringify(call!.args) }
      : { type: 'text_delta', text: reply };
  return sse([
    [
      'message_start',
      { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
    ],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: start },
    ],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: { stop_reason: message.stop_reason, stop_sequence: null },
        usage,
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ]);
}

function chatReply(body: Json, call: PlannedCall | undefined, reply: string): Response {
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  const toolCall = call && {
    id: id('call'),
    type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  };
  const finish = call ? 'tool_calls' : 'stop';
  const base = {
    id: id('chatcmpl'),
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? 'fake',
  };
  if (!body.stream)
    return Response.json({
      ...base,
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: call ? null : reply,
            ...(toolCall ? { tool_calls: [toolCall] } : {}),
          },
          finish_reason: finish,
        },
      ],
      usage,
    });
  const chunk = (delta: Json, finish_reason: string | null, extra: Json = {}) => ({
    ...base,
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason }],
    ...extra,
  });
  return sse([
    [undefined, chunk({ role: 'assistant', content: '' }, null)],
    [
      undefined,
      chunk(
        toolCall ? { tool_calls: [{ index: 0, ...toolCall }] } : { content: reply },
        null,
      ),
    ],
    [undefined, chunk({}, finish, { usage })],
    [undefined, '[DONE]'],
  ]);
}

function responsesReply(
  body: Json,
  call: PlannedCall | undefined,
  reply: string,
): Response {
  const usage = {
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  };
  const item: Json = call
    ? call.freeform
      ? {
          type: 'custom_tool_call',
          id: id('ctc'),
          call_id: id('call'),
          name: call.name,
          input: call.args,
          status: 'completed',
        }
      : {
          type: 'function_call',
          id: id('fc'),
          call_id: id('call'),
          name: call.name,
          arguments: JSON.stringify(call.args),
          status: 'completed',
        }
    : {
        type: 'message',
        id: id('msg'),
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: reply, annotations: [] }],
      };
  const response = {
    id: id('resp'),
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model: body.model ?? 'fake',
    status: 'completed',
    output: [item],
    usage,
  };
  if (!body.stream) return Response.json(response);
  const events: [string, Json][] = [
    [
      'response.created',
      {
        type: 'response.created',
        response: { ...response, status: 'in_progress', output: [] },
      },
    ],
    [
      'response.output_item.added',
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { ...item, status: 'in_progress' },
      },
    ],
  ];
  if (item.type === 'message')
    events.push(
      [
        'response.output_text.delta',
        {
          type: 'response.output_text.delta',
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          delta: reply,
        },
      ],
      [
        'response.output_text.done',
        {
          type: 'response.output_text.done',
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          text: reply,
        },
      ],
    );
  else if (item.type === 'function_call')
    events.push(
      [
        'response.function_call_arguments.delta',
        {
          type: 'response.function_call_arguments.delta',
          item_id: item.id,
          output_index: 0,
          delta: item.arguments,
        },
      ],
      [
        'response.function_call_arguments.done',
        {
          type: 'response.function_call_arguments.done',
          item_id: item.id,
          output_index: 0,
          arguments: item.arguments,
        },
      ],
    );
  else
    events.push(
      [
        'response.custom_tool_call_input.delta',
        {
          type: 'response.custom_tool_call_input.delta',
          item_id: item.id,
          output_index: 0,
          delta: item.input,
        },
      ],
      [
        'response.custom_tool_call_input.done',
        {
          type: 'response.custom_tool_call_input.done',
          item_id: item.id,
          output_index: 0,
          input: item.input,
        },
      ],
    );
  events.push(
    [
      'response.output_item.done',
      { type: 'response.output_item.done', output_index: 0, item },
    ],
    ['response.completed', { type: 'response.completed', response }],
  );
  return sse(events);
}

// ---------------------------------------------------------------------------
// Server.
// ---------------------------------------------------------------------------

export interface FakeLlmEvent {
  at: string;
  path: string;
  format: 'anthropic' | 'chat' | 'responses' | 'other';
  model?: string;
  tools: string[];
  step: number;
  /** The call the server answered with, or undefined for text. */
  answered?: { name: string; args: Json | string };
  /** Every tool result in the conversation, as the agent sent it. */
  results: string[];
  /** Set when the script wanted a tool the agent didn't offer. */
  missingTool?: string;
}

/** The request's JSON body; Codex compresses large ones with zstd. */
async function readBody(req: Request): Promise<Json> {
  const raw = new Uint8Array(await req.arrayBuffer());
  const encoding = req.headers.get('content-encoding') ?? '';
  let bytes: Uint8Array = raw;
  try {
    if (/zstd/.test(encoding)) bytes = Bun.zstdDecompressSync(raw);
    else if (/gzip/.test(encoding)) bytes = Bun.gunzipSync(raw);
    else if (/deflate/.test(encoding)) bytes = Bun.inflateSync(raw);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

export function startFakeLlm(opts: { port?: number; log?: string } = {}) {
  const log = opts.log ?? process.env.FAKE_LLM_LOG;
  const record = (e: FakeLlmEvent) => {
    if (log) appendFileSync(log, JSON.stringify(e) + '\n');
  };
  return Bun.serve({
    port: opts.port ?? 0,
    hostname: '127.0.0.1',
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/(api\/)?v1(?=\/)/, '/v1');
      if (req.method === 'GET' && /\/models$/.test(path))
        return Response.json({
          object: 'list',
          data: [{ id: 'fake-model', object: 'model', created: 0, owned_by: 'compat' }],
        });
      if (req.method !== 'POST') return new Response('not found', { status: 404 });
      const body = await readBody(req);
      const format =
        /\/messages$/.test(path) && !/chat/.test(path)
          ? 'anthropic'
          : /\/chat\/completions$/.test(path)
            ? 'chat'
            : /\/responses$/.test(path)
              ? 'responses'
              : 'other';
      if (format === 'other') {
        // Token counting and other side endpoints: a harmless answer.
        if (/count_tokens/.test(path)) return Response.json({ input_tokens: 10 });
        record({
          at: new Date().toISOString(),
          path,
          format,
          tools: [],
          step: -1,
          results: [],
        });
        return new Response('not found', { status: 404 });
      }
      const convo =
        format === 'anthropic'
          ? anthropic(body)
          : format === 'chat'
            ? chat(body)
            : responses(body);
      const step = convo.calls;
      const call = convo.tools.length ? plan(step, convo.tools) : undefined;
      const wanted = convo.tools.length && step < 3 && !call;
      const reply = convo.tools.length ? DONE : SIDE_REPLY;
      record({
        at: new Date().toISOString(),
        path,
        format,
        model: body.model,
        tools: convo.tools.map((t) => t.name),
        step,
        answered: call && { name: call.name, args: call.args },
        results: convo.results,
        ...(wanted ? { missingTool: step === 0 ? 'write' : 'shell' } : {}),
      });
      // Debugging a recipe: FAKE_LLM_DUMP=<file> keeps every request body.
      if (process.env.FAKE_LLM_DUMP)
        appendFileSync(process.env.FAKE_LLM_DUMP, JSON.stringify(body) + '\n');
      if (format === 'anthropic') return anthropicReply(body, call, reply);
      if (format === 'chat') return chatReply(body, call, reply);
      return responsesReply(body, call, reply);
    },
  });
}

if (import.meta.main) {
  const port = Number(process.env.FAKE_LLM_PORT ?? 0);
  const server = startFakeLlm({ port });
  console.log(JSON.stringify({ port: server.port }));
}
