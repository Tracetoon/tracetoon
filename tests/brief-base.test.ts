import { describe, expect, test } from 'bun:test';
import {
  addBaseContext,
  enclosingKeyLines,
  oldStarts,
} from '../src/graph/baseContext.ts';
import type { EvidenceGraph } from '../src/graph/model.ts';
import { git } from '../src/util/exec.ts';
import { makeRepo } from './helpers.ts';

const BASE = `export function pick(items: Item[]): Item | undefined {
  const sorted = items.sort((a, b) => a.rank - b.rank);
  if (!sorted.length) return undefined;
  return sorted[0];
}

export function other() {
  return 1;
}
`;
const HEAD = `export function pick(items: Item[]): Item | undefined {
  const sorted = items.sort((a, b) => a.rank - b.rank);
  if (!sorted.length) return undefined;
  const pinned = sorted.find((x) => x.pinned);
  if (pinned) return pinned;
  return sorted[0];
}

export function other() {
  return 1;
}
`;

describe('base code of adding-only hunks (`before`)', () => {
  test('the enclosing function key lines, from the hunk context', () => {
    const lines = enclosingKeyLines(
      BASE.split('\n'),
      'export function pick(items: Item[]): Item | undefined {',
      3,
    );
    expect(lines).toEqual([
      'const sorted = items.sort((a, b) => a.rank - b.rank);',
      'if (!sorted.length) return undefined;',
      'return sorted[0];',
    ]);
  });

  test('a multi-line signature is not the body; lines near the change come first', () => {
    const base = [
      'export function plan(',
      '  deps: string[],',
      '  which: (n: string) => string | undefined = (n) => find(n) ?? undefined,',
      '): Plan | undefined {',
      '  if (deps.length === 0) return undefined;',
      '  if (platform === "darwin" && which("brew")) return brewPlan();',
      '  if (platform === "linux" && which("apt-get")) return aptPlan();',
      '  if (platform === "linux" && which("dnf")) return dnfPlan();',
      '  return undefined;',
      '}',
    ];
    const lines = enclosingKeyLines(base, 'export function plan(', 5);
    expect(lines).toContain(
      'if (platform === "linux" && which("dnf")) return dnfPlan();',
    );
    expect(lines.some((l) => l.startsWith('which:'))).toBe(false);
  });

  test('old starts per file and new start', () => {
    const patch =
      'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -3,2 +3,4 @@ export function pick\n';
    expect(oldStarts(patch).get('src/a.ts\u00003')).toBe(3);
  });

  test('addBaseContext reads the base tree at the merge base', () => {
    const repo = makeRepo();
    git(repo.root, ['checkout', '-q', 'main']);
    const base = repo.commit('src/pick.ts', BASE, 'base pick');
    git(repo.root, ['checkout', '-q', '-B', 'feature']);
    repo.commit('src/pick.ts', HEAD, 'prefer pinned');
    const patch = git(repo.root, ['diff', base, 'HEAD']).stdout;
    const hunk = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)/.exec(patch)!;
    const graph = {
      nodes: [
        {
          label: 'Hunk',
          id: 'H1',
          props: {
            file: 'src/pick.ts',
            start: Number(hunk[2]),
            added: 2,
            removed: 0,
            context: hunk[3]!.trim(),
          },
        },
      ],
      rels: [],
    } as unknown as EvidenceGraph;
    addBaseContext(graph, repo.root, base, patch);
    expect(graph.nodes[0]!.props.before).toContain('return sorted[0];');
    // No merge base, no `before`.
    const none = structuredClone(graph);
    delete none.nodes[0]!.props.before;
    addBaseContext(none, repo.root, undefined, patch);
    expect(none.nodes[0]!.props.before).toBeUndefined();
  });
});

describe('pinned toolchains', () => {
  test('a pin the running version does not satisfy is named', async () => {
    const { toolchainMismatch, satisfies } = await import('../src/graph/toolchain.ts');
    const { tempDir } = await import('./helpers.ts');
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    expect(satisfies('1.2.0', '1.3.14')).toBe(false);
    expect(satisfies('>=1.3.14', '1.3.14')).toBe(true);
    expect(satisfies('^20.1.0', '20.5.0')).toBe(true);
    expect(satisfies('20', '22.1.0')).toBe(false);
    const root = tempDir();
    writeFileSync(join(root, '.bun-version'), '1.2.0\n');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ engines: { node: '>=18' } }),
    );
    const running = (t: string) => (t === 'bun' ? '1.3.14' : '22.0.0');
    expect(toolchainMismatch(root, running)).toEqual([
      'bun 1.2.0 (.bun-version; this environment runs 1.3.14)',
    ]);
  });
});
