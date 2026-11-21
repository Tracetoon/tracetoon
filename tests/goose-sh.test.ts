import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  expandVars,
  fixSh,
  gitUsrBin,
  MACHINE_ENV,
  parseRegQuery,
  persistentPath,
  readShFix,
  unfixSh,
  USER_ENV,
  type Fs,
  type Reg,
  type RegValue,
} from '../src/hook/windowsSh.ts';
import { gooseHookFailures, gooseSh } from '../src/integrations/goose/shell.ts';
import { gooseDataDir } from '../src/integrations/goose/trace.ts';
import { hookStatus, hookTargets, installHooks } from '../src/hook/install.ts';
import { integration } from '../src/integrations/registry.ts';
import { shellWords, shimPlan, isShim } from '../src/util/shShim.ts';

/** An in-memory registry; counts broadcasts. */
function fakeReg(values: Record<string, RegValue> = {}) {
  const store = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  const reg: Reg & { broadcasts: number; store: typeof store } = {
    broadcasts: 0,
    store,
    get: (key, name) => store.get(`${key}\\${name}`.toLowerCase()),
    set: (key, name, v) => void store.set(`${key}\\${name}`.toLowerCase(), v),
    broadcast() {
      reg.broadcasts++;
    },
  };
  return reg;
}

const files = (...paths: string[]): Fs => {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  return { isFile: (p) => set.has(p.toLowerCase()) };
};

const GIT = 'C:\\Program Files\\Git';
const GIT_SH = join(GIT, 'usr', 'bin', 'sh.exe');

let root: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'goose-sh-'));
  env = {
    LOCALAPPDATA: join(root, 'local'),
    APPDATA: join(root, 'roaming'),
    ProgramFiles: 'C:\\Program Files',
    SystemRoot: 'C:\\Windows',
    USERPROFILE: 'C:\\Users\\me',
    XDG_DATA_HOME: join(root, 'xdg'),
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const onWindows = describe.if(process.platform === 'win32');

onWindows('registry PATH', () => {
  test('parses reg query output, including REG_EXPAND_SZ and an empty value', () => {
    const out =
      '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;C:\\Tools\r\n\r\n';
    expect(parseRegQuery(out, 'Path')).toEqual({
      type: 'REG_EXPAND_SZ',
      value: '%USERPROFILE%\\bin;C:\\Tools',
    });
    expect(parseRegQuery('    Path    REG_SZ    \r\n', 'path')).toEqual({
      type: 'REG_SZ',
      value: '',
    });
    expect(parseRegQuery('nothing', 'Path')).toBeUndefined();
  });

  test('expands %VARS% case-insensitively and keeps unknown ones', () => {
    expect(expandVars('%userprofile%\\a;%NOPE%\\b', env)).toBe(
      'C:\\Users\\me\\a;%NOPE%\\b',
    );
  });

  test('machine entries come before user entries', () => {
    const reg = fakeReg({
      [`${MACHINE_ENV}\\Path`]: { type: 'REG_EXPAND_SZ', value: 'C:\\M1;C:\\M2' },
      [`${USER_ENV}\\Path`]: { type: 'REG_EXPAND_SZ', value: '%USERPROFILE%\\U' },
    });
    expect(persistentPath(reg, env)).toEqual(['C:\\M1', 'C:\\M2', 'C:\\Users\\me\\U']);
  });
});

onWindows('finding sh the way Goose does', () => {
  test('Git Bash having sh on its own PATH is not enough', () => {
    const reg = fakeReg({
      [`${MACHINE_ENV}\\Path`]: { type: 'REG_SZ', value: `${GIT}\\cmd` },
    });
    const state = gooseSh({
      reg,
      env: { ...env, PATH: `${GIT}\\usr\\bin` },
      fs: files(GIT_SH),
      platform: 'win32',
    });
    expect(state.found).toBeUndefined();
    expect(state.gitUsrBin).toBe(join(GIT, 'usr', 'bin'));
  });

  test('finds sh on the persistent PATH', () => {
    const reg = fakeReg({
      [`${USER_ENV}\\Path`]: { type: 'REG_SZ', value: `${GIT}\\usr\\bin` },
    });
    expect(gooseSh({ reg, env, fs: files(GIT_SH), platform: 'win32' }).found).toBe(
      GIT_SH,
    );
  });

  test("finds sh next to goose.exe, as Rust's search does", () => {
    const beside = join(
      env.LOCALAPPDATA!,
      'Programs',
      'Goose',
      'resources',
      'bin',
      'sh.exe',
    );
    expect(
      gooseSh({ reg: fakeReg(), env, fs: files(beside), platform: 'win32' }).found,
    ).toBe(beside);
  });

  test('locates Git from its install key or from git.exe on PATH', () => {
    const custom = 'D:\\Apps\\Git';
    const sh = join(custom, 'usr', 'bin', 'sh.exe');
    const byKey = fakeReg({
      'HKLM\\SOFTWARE\\GitForWindows\\InstallPath': { type: 'REG_SZ', value: custom },
    });
    expect(gitUsrBin(byKey, env, files(sh))).toBe(join(custom, 'usr', 'bin'));
    const byPath = fakeReg({
      [`${MACHINE_ENV}\\Path`]: { type: 'REG_SZ', value: `${custom}\\cmd` },
    });
    expect(gitUsrBin(byPath, env, files(sh, join(custom, 'cmd', 'git.exe')))).toBe(
      join(custom, 'usr', 'bin'),
    );
    expect(gitUsrBin(fakeReg(), env, files())).toBeUndefined();
  });
});

onWindows('--fix-sh', () => {
  test("appends Git's usr\\bin to the user PATH, keeping its type, once", () => {
    const reg = fakeReg({
      [`${USER_ENV}\\Path`]: { type: 'REG_EXPAND_SZ', value: '%USERPROFILE%\\bin' },
    });
    const deps = { reg, env, fs: files(GIT_SH), platform: 'win32' as const };
    expect(fixSh('unused', deps)).toEqual({
      result: 'added',
      kind: 'git',
      dir: join(GIT, 'usr', 'bin'),
    });
    expect(reg.get(USER_ENV, 'Path')).toEqual({
      type: 'REG_EXPAND_SZ',
      value: `%USERPROFILE%\\bin;${join(GIT, 'usr', 'bin')}`,
    });
    expect(reg.broadcasts).toBe(1);
    expect(readShFix(env)?.kind).toBe('git');
    // Now Goose finds it; running again changes nothing.
    expect(fixSh('unused', deps).result).toBe('unchanged');
    expect(reg.get(USER_ENV, 'Path')!.value.split(';')).toHaveLength(2);
  });

  test('without Git, links the shim and adds its folder', () => {
    const exe = join(root, 'tracetoon.exe');
    writeFileSync(exe, 'binary');
    const reg = fakeReg();
    const r = fixSh(exe, { reg, env, fs: files(), platform: 'win32' });
    expect(r.kind).toBe('shim');
    expect(readFileSync(join(r.dir, 'sh.exe'), 'utf8')).toBe('binary');
    expect(reg.get(USER_ENV, 'Path')).toEqual({ type: 'REG_EXPAND_SZ', value: r.dir });
  });

  test('uninstall removes only the entry it added, and the shim', () => {
    const exe = join(root, 'tracetoon.exe');
    writeFileSync(exe, 'binary');
    const reg = fakeReg({ [`${USER_ENV}\\Path`]: { type: 'REG_SZ', value: 'C:\\Keep' } });
    const r = fixSh(exe, { reg, env, fs: files(), platform: 'win32' });
    expect(unfixSh({ reg, env })).toBe(r.dir);
    expect(reg.get(USER_ENV, 'Path')).toEqual({ type: 'REG_SZ', value: 'C:\\Keep' });
    expect(readShFix(env)).toBeUndefined();
    expect(unfixSh({ reg, env })).toBeUndefined();
  });
});

describe('Goose log failures', () => {
  const line = (fields: object, at = new Date().toISOString()) =>
    JSON.stringify({ timestamp: at, level: 'WARN', fields, target: 'goose::hooks' });

  test('counts both failure shapes for the tracetoon plugin only', () => {
    const dir = join(gooseDataDir(env, root), 'logs', 'server', '2026-11-20');
    mkdirSync(dir, { recursive: true });
    const cmd = 'C:/t/tracetoon.exe hook lifecycle --agent goose --event PreToolUse';
    writeFileSync(
      join(dir, 'a.log'),
      [
        line({ message: 'Loaded plugin hooks', rule_count: 4 }),
        line({
          message: 'Plugin hook failed',
          plugin: 'tracetoon',
          event: 'SessionStart',
          error: `spawning hook \`${cmd}\``,
        }),
        line({
          message: 'Plugin hook could not be executed',
          plugin: 'tracetoon',
          event: 'PreToolUse',
          error: `spawning hook \`${cmd}\`: program not found`,
        }),
        line({
          message: 'Plugin hook failed',
          plugin: 'other',
          event: 'Stop',
          error: 'x',
        }),
      ].join('\n'),
    );
    const f = gooseHookFailures(env, root);
    expect(f.count).toBe(2);
    expect(f.last?.error).toContain('tracetoon');
  });

  test('ignores old log files', () => {
    const dir = join(gooseDataDir(env, root), 'logs', 'cli', '2026-01-01');
    mkdirSync(dir, { recursive: true });
    const old = join(dir, 'old.log');
    writeFileSync(
      old,
      line({ message: 'Plugin hook failed', plugin: 'tracetoon', error: 'x' }),
    );
    const longAgo = new Date('2026-01-01');
    utimesSync(old, longAgo, longAgo);
    expect(gooseHookFailures(env, root).count).toBe(0);
  });
});

describe('hook status', () => {
  test("an owned hook file that can't run reports its problem (doctor shows it)", () => {
    const home = join(root, 'home');
    mkdirSync(gooseDataDir({}, home), { recursive: true });
    const [target] = hookTargets(home, {}).filter((t) => t.agent === 'goose');
    installHooks(['/opt/tracetoon/bin'], [target!], {});
    const hook = integration('goose')!.hook!;
    const original = hook.problem;
    hook.problem = () => 'Goose has no sh';
    try {
      expect(hookStatus([target!])[0]).toMatchObject({
        installed: true,
        problem: 'Goose has no sh',
      });
    } finally {
      hook.problem = original;
    }
  });
});

describe('sh shim', () => {
  test('recognizes its own name', () => {
    expect(isShim('C:\\x\\shim\\sh.exe')).toBe(true);
    expect(isShim('C:\\x\\SH.EXE')).toBe(true);
    expect(isShim('C:\\x\\tracetoon.exe')).toBe(false);
  });

  test('splits the commands hook install writes', () => {
    expect(
      shellWords('C:/Users/me/tracetoon/bin/tracetoon.exe hook pre-pr --agent goose'),
    ).toEqual([
      'C:/Users/me/tracetoon/bin/tracetoon.exe',
      'hook',
      'pre-pr',
      '--agent',
      'goose',
    ]);
    expect(
      shellWords('"C:/Program Files/T/tracetoon.exe" hook lifecycle --event Stop'),
    ).toEqual([
      'C:/Program Files/T/tracetoon.exe',
      'hook',
      'lifecycle',
      '--event',
      'Stop',
    ]);
    expect(shellWords("'a b' c\\ d")).toEqual(['a b', 'c d']);
  });

  test('refuses shell syntax it does not implement', () => {
    for (const s of ['a | b', 'a; b', 'a > f', 'echo $HOME', '"unterminated', 'a && b'])
      expect(shellWords(s)).toBeUndefined();
  });

  test('runs Tracetoon commands, hands the rest to Git sh, else 127', () => {
    const hook = ['-c', '"C:/Program Files/T/tracetoon.exe" hook pre-pr --agent goose'];
    expect(shimPlan(hook, undefined)).toEqual({
      kind: 'run',
      program: 'C:/Program Files/T/tracetoon.exe',
      args: ['hook', 'pre-pr', '--agent', 'goose'],
    });
    expect(shimPlan(['-c', 'ls | wc -l'], GIT_SH)).toEqual({
      kind: 'delegate',
      sh: GIT_SH,
      args: ['-c', 'ls | wc -l'],
    });
    expect(shimPlan(['-c', 'notepad.exe x'], undefined).kind).toBe('reject');
    expect(shimPlan(['script.sh'], undefined).kind).toBe('reject');
  });
});
