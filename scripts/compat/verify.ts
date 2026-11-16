/**
 * Verify one Recommended agent release against Tracetoon, without spending
 * money: the released CLI runs for real against the scripted model in
 * fake-llm.ts (or, for Cursor, one short free-plan session), inside a
 * throwaway home folder and repository. Nothing touches the real user's
 * agents or settings.
 *
 *   bun scripts/compat/verify.ts --integration <claude|codex|opencode|copilot|cursor|zed-claude|zed-codex|<target>>
 *                                [--version 2.1.325] [--install] [--out result.json]
 *                                [--diagnostics <dir>] [--keep]
 *
 * --install runs the recipe's installer for --version first (CI). Without it
 * the CLI already on PATH is used, and --version, when given, must match it.
 * FAKE_LLM_DUMP=<file> keeps every request the agent sent, for writing recipes.
 *
 * Checks, in order (a failed one stops the ones that need it):
 *   install     the CLI reports the version; Tracetoon detects the agent; the hook
 *               installs, a second install changes nothing
 *   end-to-end  the agent edits a file, runs an ordinary command, then tries
 *               `gh pr create`; the hook must stop that one and nothing else
 *   hooks       the user's own hook still ran and survives install and uninstall
 *   tracing     Tracetoon finds the session and its edit, knows every record type,
 *               and survives a damaged log
 *   evidence    a PR draft built from the session picks it, leaves out a decoy,
 *               redacts a planted secret, and publishes to a fake GitHub
 *
 * The result (compat/verification.json's run shape) goes to --out and stdout.
 * Exit 0 passed, 1 failed, 3 blocked (the environment, not Tracetoon).
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { COMPAT_FILE, type FakeLlmEvent } from './fake-llm.ts';
import { RECIPES, type Command, type Sandbox } from './recipes.ts';
import { scrubEmails } from './scrub.ts';
import type {
  CheckId,
  CheckResult,
  FailureCategory,
  RunStatus,
  VerificationRun,
} from './records.ts';
import upstream from '../../compat/upstream.json';
import { traceLabel } from '../../src/integrations/registry.ts';

const ROOT = resolve(import.meta.dir, '../..');
const CLI = join(ROOT, 'src', 'cli.ts');
const FAKE_GH = join(ROOT, 'tests', 'fake-gh.ts');
/**
 * Tracetoon's answer to a PR command: the general DENY_REASON or, inside a
 * registered task, the task's own instruction (src/hook/prHook.ts). Both send
 * the agent to the skill and `tracetoon publish`.
 */
const DENY_MARK = /tracetoon publish|tracetoon skill/i;
/** A token-shaped secret the user "pasted"; it must never reach the PR. */
const SECRET = `ghp_${'C0mpat5ecret'.repeat(3)}`;
const PROMPT = `Compatibility check. Create ${COMPAT_FILE}, check git status, then open a pull request. (CI token for reference: ${SECRET})`;
/** The same task spelled out for a real model, which has to be told exactly what to run. */
const REAL_PROMPT =
  `This is an automated compatibility check; keep it short. 1) Create the file ${COMPAT_FILE} containing the line "written by the tracetoon compatibility check". ` +
  `2) Run the shell command: git status --short. 3) Run the shell command: ${'gh pr create --title "Compat check" --body "Opened by the compatibility check"'}. ` +
  `If a hook blocks step 3, stop and report that; do not retry or work around it. Token for reference (do not use it): ${SECRET}`;
const AGENT_TIMEOUT_MS = 240_000;

class CheckFailure extends Error {
  constructor(
    public check: CheckId,
    public category: FailureCategory,
    message: string,
  ) {
    super(message);
  }
}

const { values: opts } = parseArgs({
  options: {
    integration: { type: 'string' },
    version: { type: 'string' },
    install: { type: 'boolean', default: false },
    out: { type: 'string' },
    keep: { type: 'boolean', default: false },
    diagnostics: { type: 'string' },
  },
});

function log(line: string) {
  process.stderr.write(`${line}\n`);
}

/** Run a command; on Windows npm-installed CLIs are .cmd shims, so go through the shell. */
function exec(c: Command, env: NodeJS.ProcessEnv, cwd: string, timeout = 120_000) {
  const win = process.platform === 'win32';
  const r = spawnSync(c.cmd, c.args, {
    cwd,
    env: { ...env, ...c.env },
    encoding: 'utf8',
    timeout,
    shell: win && !/\.(exe|com)$/i.test(c.cmd) && c.cmd !== process.execPath,
    windowsHide: true,
    // The agents read the prompt from argv; an open stdin makes some wait for more.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    code: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    timedOut: r.error?.message.includes('ETIMEDOUT') ?? false,
    error: r.error,
  };
}

/** Quote one argument for cmd.exe when a .cmd shim runs through the shell. */
function shellSafe(c: Command): Command {
  if (process.platform !== 'win32') return c;
  return {
    ...c,
    args: c.args.map((a) => (/[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)),
  };
}

function tracetoon(s: Sandbox, args: string[], cwd = s.repo) {
  return exec({ cmd: process.execPath, args: [CLI, '--json', ...args] }, s.env, cwd);
}

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * A clean environment: only what a process needs to start, with every home,
 * config and data folder inside the sandbox, so nothing reads or writes the
 * real user's agents. Model provider variables are never passed through.
 */
function sandboxEnv(home: string, bin: string): NodeJS.ProcessEnv {
  const keep = [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'windir',
    'ComSpec',
    'COMSPEC',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'TERM',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramData',
    'CommonProgramFiles',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'OS',
    'SHELL',
    'CI',
    'GITHUB_ACTIONS',
    'RUNNER_OS',
    'RUNNER_TEMP',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const path = process.env.PATH ?? process.env.Path ?? '';
  delete env.PATH;
  delete env.Path;
  // ~/.local/bin of the real user: where installer-only CLIs (Cursor) land.
  env[pathKey] =
    `${bin}${delimiter}${path}${delimiter}${join(homedir(), '.local', 'bin')}`;
  // npm's global prefix stays the real one, so CLIs installed with -g still run.
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    XDG_CACHE_HOME: join(home, '.cache'),
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CODEX_HOME: join(home, '.codex'),
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    TRACETOON_CONFIG: join(home, 'tracetoon-config.json'),
    TRACETOON_GH_SCRIPT: FAKE_GH,
    TRACETOON_NO_UPDATE_CHECK: '1',
    // Tracetoon steps aside when CI is set (src/hook/switches.ts); the check
    // stands in for a user's machine, so it opts back in.
    TRACETOON: '1',
    FAKE_GH_LOG: join(home, 'fake-gh.log'),
    NO_COLOR: '1',
  });
  if (process.platform === 'win32') {
    // npm global installs live under the real APPDATA; keep them reachable.
    const real = process.env.APPDATA;
    if (real) env[pathKey] = `${env[pathKey]}${delimiter}${join(real, 'npm')}`;
  }
  return env;
}

/** The helper scripts the agent may run: the user's own hook and a `gh` that records calls. */
function writeBin(bin: string, home: string) {
  mkdirSync(bin, { recursive: true });
  const marker = join(home, 'user-hook.ran').replace(/\\/g, '/');
  writeFileSync(
    join(bin, 'user-hook.cjs'),
    `require('fs').appendFileSync(${JSON.stringify(marker)}, 'ran\\n');\n`,
  );
  // If the hook fails to stop `gh pr create`, this records that the real call went through.
  const ghLog = join(home, 'shell-gh.log').replace(/\\/g, '/');
  writeFileSync(
    join(bin, 'gh-shim.cjs'),
    `require('fs').appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nconsole.log('https://github.com/acme/demo/pull/99');\n`,
  );
  const shim = join(bin, 'gh-shim.cjs').replace(/\\/g, '/');
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\nexec node "${shim}" "$@"\n`, {
    mode: 0o755,
  });
  writeFileSync(join(bin, 'gh.cmd'), `@node "${shim}" %*\r\n`);
  // For real-model runs, where there is no fake model to watch: Tracetoon's hook,
  // run through a recorder that logs every call and Tracetoon's answer.
  const recorder = join(bin, 'hook-recorder.cjs');
  writeFileSync(
    recorder,
    `const { spawnSync } = require('child_process');
const fs = require('fs');
const input = fs.readFileSync(0);
const r = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(CLI)}, ...process.argv.slice(2)], { input });
fs.appendFileSync(${JSON.stringify(join(home, 'hook-calls.jsonl'))}, JSON.stringify({ args: process.argv.slice(2), input: input.toString(), stdout: String(r.stdout), stderr: String(r.stderr), code: r.status }) + '\\n');
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
process.exit(r.status ?? 1);
`,
  );
  writeFileSync(
    join(bin, 'tracetoon-hook'),
    `#!/bin/sh\nexec node "${recorder.replace(/\\/g, '/')}" "$@"\n`,
    { mode: 0o755 },
  );
}

interface HookCall {
  args: string[];
  input: string;
  stdout: string;
  stderr: string;
  code: number | null;
}

function hookCalls(home: string): HookCall[] {
  const file = join(home, 'hook-calls.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Words an agent prints when its account, not Tracetoon, stopped the run. */
const ACCOUNT_TROUBLE =
  /quota|usage limit|rate.?limit|out of credits|unauthori[sz]ed|invalid api key|not logged in|authenticat|\b40[13]\b|upgrade your plan|billing/i;

/** An unrelated Claude Code session in the same repository: old, other branch, other file. */
function writeDecoy(s: Sandbox) {
  const dir = join(
    s.env.CLAUDE_CONFIG_DIR!,
    'projects',
    s.repo.replace(/[^A-Za-z0-9]/g, '-'),
  );
  mkdirSync(dir, { recursive: true });
  const start = Date.now() - 20 * 24 * 3600_000;
  let n = 0;
  const base = () => ({
    cwd: s.repo,
    gitBranch: 'docs-cleanup',
    sessionId: 'decoy-session',
    timestamp: new Date(start + n * 1000).toISOString(),
    uuid: `decoy-${n++}`,
  });
  const file = join(s.repo, 'docs', 'unrelated.md');
  const lines = [
    {
      type: 'user',
      ...base(),
      message: { role: 'user', content: 'Tidy the unrelated docs page' },
    },
    {
      type: 'assistant',
      ...base(),
      message: {
        id: 'decoy-m1',
        model: 'claude-test-1',
        content: [
          {
            type: 'tool_use',
            id: 'decoy-t1',
            name: 'Write',
            input: { file_path: file, content: '# Unrelated\n' },
          },
        ],
      },
    },
    {
      type: 'user',
      ...base(),
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'decoy-t1', content: 'ok' }],
      },
      toolUseResult: {
        type: 'create',
        filePath: file,
        content: '# Unrelated\n',
        structuredPatch: [],
      },
    },
  ];
  writeFileSync(
    join(dir, 'decoy-session.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

function readEvents(file: string): FakeLlmEvent[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Every file under a folder changed since `since`. */
function changedFiles(dir: string, since: number, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) changedFiles(p, since, out);
    else if (st.mtimeMs >= since) out.push(p);
  }
  return out;
}

async function main(): Promise<number> {
  // A recipe is named by its target ("zed-claude") or its integration ("claude").
  const key = opts.integration;
  const targets = upstream.targets as Record<
    string,
    { integration: string; surface: string }
  >;
  const recipe = key
    ? (RECIPES[key] ?? RECIPES[targets[key]?.integration ?? ''])
    : undefined;
  if (!key || !recipe) {
    log(`usage: --integration ${Object.keys(RECIPES).join('|')}`);
    return 2;
  }
  // The version comes from a package feed and ends up on a command line.
  if (opts.version && !/^[0-9A-Za-z.+-]{1,64}$/.test(opts.version)) {
    log(`not a version: ${opts.version}`);
    return 2;
  }
  const id = recipe.integration;
  const target = Object.entries(upstream.targets).find(
    ([k, t]) => k === key || (t.integration === key && t.surface === 'cli'),
  );
  const checks: Partial<Record<CheckId, CheckResult>> = {};
  const os =
    process.env.COMPAT_OS ??
    (process.platform === 'win32'
      ? 'windows-latest'
      : process.platform === 'darwin'
        ? 'macos-latest'
        : 'ubuntu-latest');
  let version = opts.version ?? '';
  let status: RunStatus = 'passed';
  let failureCategory: FailureCategory | undefined;
  let detail: string | undefined;

  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), `tracetoon-compat-${key}-`)),
  );
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  writeBin(bin, home);
  const llmLog = join(root, 'fake-llm.jsonl');
  // The model runs in its own process: the agent is started with spawnSync,
  // which would block a server living in this one.
  const server = spawn(process.execPath, [join(import.meta.dir, 'fake-llm.ts')], {
    env: { ...process.env, FAKE_LLM_LOG: llmLog },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise<number>((ok, fail) => {
    let buf = '';
    server.stdout!.on('data', (d) => {
      buf += d;
      const m = /"port":\s*(\d+)/.exec(buf);
      if (m) ok(Number(m[1]));
    });
    server.on('exit', (code) => fail(new Error(`fake model exited (${code})`)));
  });
  const s: Sandbox = {
    home,
    repo,
    bin,
    env: sandboxEnv(home, bin),
    llm: `http://127.0.0.1:${port}`,
  };
  writeFileSync(s.env.TRACETOON_CONFIG!, JSON.stringify({ comic: 'off' }));
  log(`sandbox ${root}; fake model on ${s.llm}`);

  const check = async (name: CheckId, body: () => void | Promise<void>) => {
    try {
      await body();
      checks[name] = 'pass';
      log(`pass  ${name}`);
    } catch (e) {
      checks[name] = 'fail';
      throw e;
    }
  };

  try {
    // Toy repository with a remote, so publish can push.
    mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'compat@example.com');
    git(repo, 'config', 'user.name', 'Compat');
    git(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'README.md'), '# compat\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'base');
    const remote = join(root, 'remote.git');
    git(root, 'init', '-q', '--bare', remote);
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'checkout', '-q', '-b', 'compat-check');

    recipe.configure(s);
    const seeded = recipe.seedUserHook(s);
    const seededText = readFileSync(seeded, 'utf8');

    await check('install', () => {
      if (recipe.secret && !process.env[recipe.secret])
        throw new CheckFailure(
          'install',
          'quota',
          `${recipe.secret} is not set, so the free-plan session can't run`,
        );
      if (opts.install) {
        for (const c of recipe.install(version)) {
          const r = exec(shellSafe(c), { ...process.env }, root, 600_000);
          if (r.code !== 0)
            throw new CheckFailure(
              'install',
              'infra',
              `install failed: ${(r.stderr || r.stdout).slice(-400)}`,
            );
        }
      }
      const versionCmd =
        typeof recipe.version === 'function' ? recipe.version(version) : recipe.version;
      const v = exec(shellSafe(versionCmd), s.env, repo);
      const reported = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(v.stdout + v.stderr)?.[0];
      if (!reported)
        throw new CheckFailure(
          'install',
          'install',
          `no version from ${versionCmd.cmd}: ${v.stdout}${v.stderr}`,
        );
      // An installer that can't pin a version may bring a newer build; record what ran.
      if (version && reported !== version && recipe.pinned !== false)
        throw new CheckFailure(
          'install',
          'install',
          `${versionCmd.cmd} reports ${reported}, expected ${version}`,
        );
      version = reported;
      const list = JSON.parse(tracetoon(s, ['integrations']).stdout);
      const row = list.find((r: any) => r.id === id);
      if (!row?.skill?.present)
        throw new CheckFailure(
          'install',
          'install',
          'tracetoon does not detect the agent',
        );
      // A real-model run has no fake model to watch, so the hook runs through the recorder.
      const program =
        recipe.evidence === 'free-plan' ? ['--program', join(bin, 'tracetoon-hook')] : [];
      const first = tracetoon(s, ['hook', 'install', ...program]);
      const mine = (out: string) =>
        JSON.parse(out).changes?.find?.((c: any) => c.agent === id) ??
        JSON.parse(out).find?.((c: any) => c.agent === id);
      const installed = mine(first.stdout);
      if (first.code !== 0 || installed?.result !== 'installed')
        throw new CheckFailure(
          'install',
          'hook-config',
          `hook install: ${first.stdout}${first.stderr}`,
        );
      const second = mine(tracetoon(s, ['hook', 'install', ...program]).stdout);
      if (second?.result !== 'unchanged')
        throw new CheckFailure(
          'install',
          'hook-config',
          `second hook install was not a no-op: ${JSON.stringify(second)}`,
        );
      recipe.afterHookInstall?.(s);
    });

    /**
     * A real model can't be scripted, so the run is judged by what happened:
     * the file exists, Tracetoon's hook answered the PR command with a block
     * (the recorder saw it), let an ordinary command through, and `gh pr
     * create` never ran. A run the account stopped (quota, sign-in) is blocked.
     */
    const realModelRun = (r: ReturnType<typeof exec>) => {
      const output = `${r.stdout}\n${r.stderr}`;
      // Any of Tracetoon's hooks may answer the PR command: Cursor's preToolUse
      // (lifecycle) hook blocks it before beforeShellExecution (pre-pr) runs.
      const calls = hookCalls(home);
      if (!existsSync(join(repo, COMPAT_FILE))) {
        if (r.timedOut || ACCOUNT_TROUBLE.test(output))
          throw new CheckFailure(
            'end-to-end',
            r.timedOut ? 'infra' : 'quota',
            `the agent's service stopped the run: ${output.slice(-400)}`,
          );
        throw new CheckFailure(
          'end-to-end',
          'install',
          `the agent did not write ${COMPAT_FILE}: ${output.slice(-400)}`,
        );
      }
      const shellGh = join(home, 'shell-gh.log');
      if (existsSync(shellGh) && /"pr","create"/.test(readFileSync(shellGh, 'utf8')))
        throw new CheckFailure(
          'end-to-end',
          'hook-protocol',
          '`gh pr create` ran: the hook did not stop it',
        );
      const denied = calls.filter(
        (c) => /gh pr create/.test(c.input) && DENY_MARK.test(c.stdout + c.stderr),
      );
      if (!denied.length)
        throw new CheckFailure(
          'end-to-end',
          calls.length ? 'hook-protocol' : 'hook-config',
          calls.length
            ? `Tracetoon's hook ran ${calls.length} time(s) but never blocked the PR command`
            : "Tracetoon's hook never ran",
        );
      if (
        calls.some(
          (c) => /git status/.test(c.input) && DENY_MARK.test(c.stdout + c.stderr),
        )
      )
        throw new CheckFailure(
          'end-to-end',
          'hook-protocol',
          'the hook blocked an ordinary command',
        );
    };

    const started = Date.now();
    await check('end-to-end', () => {
      const prompt = recipe.evidence === 'free-plan' ? REAL_PROMPT : PROMPT;
      const r = exec(
        shellSafe(recipe.run(s, prompt, version)),
        s.env,
        repo,
        AGENT_TIMEOUT_MS,
      );
      writeFileSync(
        join(root, 'agent-output.txt'),
        `exit ${r.code}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`,
      );
      if (recipe.evidence === 'free-plan') return realModelRun(r);
      const events = readEvents(llmLog).filter((e) => e.format !== 'other');
      if (!events.length)
        throw new CheckFailure(
          'end-to-end',
          r.timedOut ? 'infra' : 'install',
          `the agent never called the model (exit ${r.code}): ${(r.stderr || r.stdout).slice(-600)}`,
        );
      const missing = events.find((e) => e.missingTool);
      if (missing)
        throw new CheckFailure(
          'end-to-end',
          'install',
          `the agent offered no ${missing.missingTool} tool the script recognizes (tools: ${missing.tools.join(', ')})`,
        );
      const last = events.reduce((a, b) =>
        b.results.length >= a.results.length ? b : a,
      );
      const [write, ordinary, pr] = last.results;
      if (!existsSync(join(repo, COMPAT_FILE)))
        throw new CheckFailure(
          'end-to-end',
          'install',
          `the agent did not write ${COMPAT_FILE}`,
        );
      if (pr === undefined)
        throw new CheckFailure(
          'end-to-end',
          'hook-protocol',
          `the agent stopped before the PR command (results: ${last.results.length}; exit ${r.code})`,
        );
      if (ordinary !== undefined && DENY_MARK.test(ordinary))
        throw new CheckFailure(
          'end-to-end',
          'hook-protocol',
          'the hook blocked an ordinary command',
        );
      const shellGh = join(home, 'shell-gh.log');
      if (existsSync(shellGh) && /"pr","create"/.test(readFileSync(shellGh, 'utf8')))
        throw new CheckFailure(
          'end-to-end',
          'hook-protocol',
          '`gh pr create` ran: the hook did not stop it',
        );
      if (!DENY_MARK.test(pr))
        throw new CheckFailure(
          'end-to-end',
          'hook-protocol',
          `the agent did not get Tracetoon's answer for the PR command; it got: ${pr.slice(0, 300)}`,
        );
      void write;
    });

    await check('hooks', () => {
      const marker = join(home, 'user-hook.ran');
      // OpenCode's seeded "hook" is a plugin file, which runs no command of its own.
      if (seeded.endsWith('.json') && !existsSync(marker))
        throw new CheckFailure(
          'hooks',
          'hook-config',
          "the user's own hook did not run next to Tracetoon's",
        );
      const u = tracetoon(s, ['hook', 'uninstall']);
      if (u.code !== 0)
        throw new CheckFailure(
          'hooks',
          'hook-config',
          `uninstall: ${u.stdout}${u.stderr}`,
        );
      if (!existsSync(seeded))
        throw new CheckFailure(
          'hooks',
          'hook-config',
          "uninstall removed the user's own hook file",
        );
      const after = readFileSync(seeded, 'utf8');
      const same = seeded.endsWith('.json')
        ? JSON.stringify(JSON.parse(after)) === JSON.stringify(JSON.parse(seededText))
        : after === seededText;
      if (!same)
        throw new CheckFailure(
          'hooks',
          'hook-config',
          `uninstall did not restore the user's config:\n${after}`,
        );
    });

    await check('tracing', () => {
      const found = exec(
        {
          cmd: process.execPath,
          args: [
            join(ROOT, 'scripts', 'canary-check.ts'),
            repo,
            `${recipe.adapter}:${COMPAT_FILE}`,
          ],
        },
        s.env,
        ROOT,
      );
      if (found.code !== 0)
        throw new CheckFailure(
          'tracing',
          'trace',
          found.stdout.trim() || found.stderr.trim(),
        );
      const probe = tracetoon(s, ['doctor', '--probe', '--strict']);
      if (probe.code === 5)
        throw new CheckFailure(
          'tracing',
          'trace',
          `unknown record types: ${probe.stdout.slice(0, 800)}`,
        );
      // A log cut off mid-line (a crash, a full disk) must not break the reader.
      const logs = changedFiles(home, started).filter(
        (f) => f.endsWith('.jsonl') && !f.includes('decoy'),
      );
      for (const f of logs) appendFileSync(f, '{"type":"truncat');
      const damaged = tracetoon(s, ['doctor', '--probe']);
      try {
        JSON.parse(damaged.stdout);
      } catch {
        throw new CheckFailure(
          'tracing',
          'trace',
          `a damaged log broke the reader: ${damaged.stderr.slice(-400)}`,
        );
      }
      for (const f of logs)
        writeFileSync(f, readFileSync(f, 'utf8').replace(/\{"type":"truncat$/, ''));
    });

    await check('evidence', () => {
      writeDecoy(s);
      git(repo, 'add', COMPAT_FILE);
      git(repo, 'commit', '-q', '-m', 'Add compat file');
      const d = tracetoon(s, ['digest', '--offline']);
      if (d.code !== 0)
        throw new CheckFailure('evidence', 'evidence', `digest: ${d.stdout}${d.stderr}`);
      const digest = JSON.parse(d.stdout);
      const sessions: any[] = digest.sessions ?? [];
      const label = traceLabel(recipe.adapter);
      const included = sessions.filter((x) => x.band === 'included');
      if (!included.some((x) => x.agent === label))
        throw new CheckFailure(
          'evidence',
          'evidence',
          `the agent's session was not picked: ${JSON.stringify(sessions)}`,
        );
      // The run made one session; anything else included is the decoy.
      if (included.length !== 1)
        throw new CheckFailure(
          'evidence',
          'evidence',
          `an unrelated session was included: ${JSON.stringify(included)}`,
        );
      const ctx = tracetoon(s, ['context', '--offline']);
      if (ctx.code !== 0)
        throw new CheckFailure(
          'evidence',
          'evidence',
          `context: ${ctx.stdout}${ctx.stderr}`,
        );
      const runDir: string = digest.runDir;
      writeFileSync(join(runDir, 'title.txt'), 'Add compat file\n');
      writeFileSync(
        join(runDir, 'body.md'),
        `## Summary\nAdds \`${COMPAT_FILE}\` for the compatibility check.\n`,
      );
      const r = tracetoon(s, ['render']);
      if (r.code !== 0)
        throw new CheckFailure('evidence', 'evidence', `render: ${r.stdout}${r.stderr}`);
      const p = tracetoon(s, ['publish', '--push']);
      if (p.code !== 0)
        throw new CheckFailure('evidence', 'evidence', `publish: ${p.stdout}${p.stderr}`);
      const ghLog = readFileSync(s.env.FAKE_GH_LOG!, 'utf8');
      if (!/"create"/.test(ghLog))
        throw new CheckFailure('evidence', 'evidence', 'publish never created the PR');
      if (ghLog.includes(SECRET))
        throw new CheckFailure(
          'evidence',
          'evidence',
          'the planted secret reached the PR',
        );
      for (const f of changedFiles(runDir, 0))
        if (/\.(md|txt|json|html)$/.test(f) && readFileSync(f, 'utf8').includes(SECRET))
          throw new CheckFailure(
            'evidence',
            'evidence',
            `the planted secret is in ${f.slice(runDir.length + 1)}`,
          );
    });
  } catch (e) {
    if (e instanceof CheckFailure) {
      failureCategory = e.category;
      status = e.category === 'infra' || e.category === 'quota' ? 'blocked' : 'failed';
      detail = e.message;
      log(`FAIL  ${e.check} (${e.category}): ${e.message}`);
    } else {
      status = 'blocked';
      failureCategory = 'infra';
      detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
      log(`ERROR ${detail}`);
    }
  } finally {
    server.kill();
  }
  for (const c of ['install', 'end-to-end', 'hooks', 'tracing', 'evidence'] as CheckId[])
    checks[c] ??= 'skip';

  const run: VerificationRun = {
    target: target?.[0] ?? `${id}-cli`,
    integration: id,
    surface: target?.[1].surface ?? 'cli',
    os,
    upstreamVersion: version || 'unknown',
    status,
    evidence: recipe.evidence,
    checks,
    ...(failureCategory ? { failureCategory } : {}),
    ...(detail ? { detail: detail.slice(0, 1000) } : {}),
    verifiedAt: new Date().toISOString(),
    workflowUrl: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : 'local',
    tracetoonRevision: git(ROOT, 'rev-parse', 'HEAD'),
  };
  const json = JSON.stringify(run, null, 2);
  if (opts.out) {
    mkdirSync(dirname(resolve(opts.out)), { recursive: true });
    writeFileSync(opts.out, json + '\n');
  }
  console.log(json);
  // What a maintainer needs to see why a run failed: the prompt, the fake token
  // and the toy repo are made up by the check. A free-plan agent also puts its
  // account's email in hook payloads (Cursor's user_email), so email addresses
  // are scrubbed before anything is uploaded.
  if (opts.diagnostics) {
    mkdirSync(opts.diagnostics, { recursive: true });
    const files: [string, string][] = [
      [join(root, 'agent-output.txt'), 'agent-output.txt'],
      [llmLog, 'fake-llm.jsonl'],
      [join(home, 'hook-calls.jsonl'), 'hook-calls.jsonl'],
      [join(home, 'fake-gh.log'), 'fake-gh.log'],
      [join(home, 'shell-gh.log'), 'shell-gh.log'],
    ];
    for (const [from, to] of files)
      if (existsSync(from))
        writeFileSync(
          join(opts.diagnostics, to),
          scrubEmails(readFileSync(from, 'utf8')),
        );
  }
  if (opts.keep || status !== 'passed') log(`kept ${root}`);
  else rmSync(root, { recursive: true, force: true });
  return status === 'passed' ? 0 : status === 'blocked' ? 3 : 1;
}

process.exit(await main());
