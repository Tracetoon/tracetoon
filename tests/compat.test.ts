/**
 * The pieces of the upstream compatibility workflow that run without an agent:
 * the scripted model's choice of tools, and how results are recorded.
 */
import { describe, expect, test } from 'bun:test';
import {
  COMPAT_FILE,
  ORDINARY_COMMAND,
  PR_COMMAND,
  plan,
  type ToolSpec,
} from '../scripts/compat/fake-llm.ts';
import { merge } from '../scripts/compat/publish.ts';
import { RECIPES } from '../scripts/compat/recipes.ts';
import type { VerificationRun } from '../scripts/compat/records.ts';
import { INTEGRATIONS } from '../src/integrations/registry.ts';
import upstream from '../compat/upstream.json';

const fn = (name: string, ...props: string[]): ToolSpec => ({
  name,
  schema: { properties: Object.fromEntries(props.map((p) => [p, { type: 'string' }])) },
});

describe('scripted model', () => {
  test("uses Claude Code's Write and Bash tools", () => {
    const tools = [fn('Write', 'file_path', 'content'), fn('Bash', 'command', 'timeout')];
    expect(plan(0, tools)).toMatchObject({
      name: 'Write',
      args: { file_path: COMPAT_FILE },
    });
    expect(plan(1, tools)).toEqual({ name: 'Bash', args: { command: ORDINARY_COMMAND } });
    expect(plan(2, tools)).toEqual({ name: 'Bash', args: { command: PR_COMMAND } });
    expect(plan(3, tools)).toBeUndefined();
  });

  test("fills OpenCode's camelCase path and its command description", () => {
    const tools = [
      fn('write', 'filePath', 'content'),
      fn('bash', 'command', 'description'),
    ];
    expect(plan(0, tools)).toMatchObject({ args: { filePath: COMPAT_FILE } });
    expect(plan(2, tools)).toMatchObject({
      args: { command: PR_COMMAND, description: 'compatibility check' },
    });
  });

  test('drives Codex code mode through its exec tool', () => {
    const exec: ToolSpec = {
      name: 'exec',
      freeform: true,
      description:
        'Run JavaScript. Call nested tools as `await tools.exec_command(...)`.',
    };
    const write = plan(0, [exec]);
    expect(write).toMatchObject({ name: 'exec', freeform: true });
    expect(write?.args).toContain('tools.apply_patch(');
    expect(write?.args).toContain(`*** Add File: ${COMPAT_FILE}`);
    expect(plan(2, [exec])?.args).toContain('tools.exec_command(');
    expect(plan(2, [exec])?.args).toContain('gh pr create');
  });

  test('a shell tool that takes an argument list gets one', () => {
    const shell: ToolSpec = {
      name: 'shell',
      schema: { properties: { command: { type: 'array' } } },
    };
    const call = plan(1, [shell]);
    expect(Array.isArray((call?.args as Record<string, unknown>).command)).toBe(true);
  });

  test('says nothing when the agent offers no tool it recognizes', () => {
    expect(plan(0, [fn('sleep', 'duration_ms')])).toBeUndefined();
  });
});

describe('verification recipes', () => {
  test('every Recommended agent has a target and a recipe', () => {
    const targets = upstream.targets as Record<
      string,
      { integration: string; evidence: string }
    >;
    for (const i of INTEGRATIONS.filter((i) => i.supportTier === 'recommended')) {
      const target = Object.values(targets).find((t) => t.integration === i.id);
      expect(target).toBeDefined();
      expect(RECIPES[i.id]?.evidence).toBe(target!.evidence as 'fake-llm' | 'free-plan');
    }
  });

  test('a free-plan recipe names the secret it needs, and a fake-model one needs none', () => {
    for (const r of Object.values(RECIPES)) {
      if (r.evidence === 'free-plan') expect(r.secret).toBeTruthy();
      else expect(r.secret).toBeUndefined();
    }
  });
});

describe('recording results', () => {
  const run = (version: string, at: string): VerificationRun => ({
    target: 'codex-cli',
    integration: 'codex',
    surface: 'cli',
    os: 'ubuntu-latest',
    upstreamVersion: version,
    status: 'passed',
    evidence: 'fake-llm',
    checks: {},
    verifiedAt: at,
    workflowUrl: 'https://example.test/run',
    tracetoonRevision: 'abc',
  });
  const empty = { schemaVersion: 1 as const, detected: {}, runs: [] };

  test('adds new runs once and keeps the history', () => {
    const first = merge(empty, [run('1.0.0', '2026-11-01T00:00:00Z')], {});
    const again = merge(
      first,
      [run('1.0.0', '2026-11-01T00:00:00Z'), run('1.1.0', '2026-11-02T00:00:00Z')],
      {},
    );
    expect(again.runs.map((r) => r.upstreamVersion)).toEqual(['1.0.0', '1.1.0']);
  });

  test('a local run is never recorded: only workflow runs, with a link', () => {
    const local = { ...run('1.0.0', '2026-11-01T00:00:00Z'), workflowUrl: 'local' };
    expect(merge(empty, [local], {}).runs).toEqual([]);
  });

  test('a run whose version was never read is not recorded', () => {
    expect(merge(empty, [run('unknown', '2026-11-01T00:00:00Z')], {}).runs).toEqual([]);
  });

  test('a newly detected release is stamped once', () => {
    const a = merge(empty, [], { 'codex-cli': '2.0.0' }, '2026-11-03T00:00:00Z');
    const b = merge(a, [], { 'codex-cli': '2.0.0' }, '2026-11-04T00:00:00Z');
    expect(b.detected['codex-cli']).toEqual({
      upstreamVersion: '2.0.0',
      detectedAt: '2026-11-03T00:00:00Z',
    });
  });
});
