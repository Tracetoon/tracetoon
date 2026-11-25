import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './helpers.ts';
import { prepareDependencies } from '../scripts/dependencies.ts';

function g(cwd: string, ...args: string[]): string {
  const r = spawnSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

/** An upstream "Showtail" with two commits, and a local copy cloned before the second. */
function fixture() {
  const upstream = tempDir('tracetoon-deps-upstream-');
  g(upstream, 'init', '-q', '-b', 'main');
  const pkg = join(upstream, 'packages', 'agent-traces');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'index.ts'), 'export const v = 1;\n');
  g(upstream, 'add', '.');
  g(upstream, 'commit', '-qm', 'one');
  const stale = join(tempDir('tracetoon-deps-stale-'), 'Showtail');
  g(upstream, 'clone', '-q', upstream, stale);
  writeFileSync(join(pkg, 'index.ts'), 'export const v = 2;\n');
  g(upstream, 'commit', '-qam', 'two');
  const revision = g(upstream, 'rev-parse', 'HEAD');
  const packageTree = g(upstream, 'rev-parse', 'HEAD:packages/agent-traces');
  const base = tempDir('tracetoon-deps-base-');
  const lock = (repository: string) =>
    writeFileSync(
      join(base, 'build-dependencies.json'),
      JSON.stringify({
        schema: 'tracetoon.build-dependencies/v1',
        showtail: { repository, revision, packageTree },
      }),
    );
  return { upstream, stale, base, revision, lock };
}

describe('pinned dependency checkout', () => {
  test('a local source that predates the pin is topped up from the locked repository', () => {
    const f = fixture();
    f.lock(f.upstream);
    const result = prepareDependencies(f.stale, f.base);
    expect(result.revision).toBe(f.revision);
    const target = join(f.base, '.tracetoon-deps', 'Showtail');
    expect(
      readFileSync(join(target, 'packages', 'agent-traces', 'index.ts'), 'utf8'),
    ).toContain('v = 2');
  });

  test('a failed clone leaves nothing behind, so the next run starts over', () => {
    const f = fixture();
    f.lock(join(f.upstream, 'missing'));
    expect(() => prepareDependencies(f.stale, f.base)).toThrow();
    expect(existsSync(join(f.base, '.tracetoon-deps', 'Showtail'))).toBe(false);
    f.lock(f.upstream);
    expect(prepareDependencies(f.stale, f.base).revision).toBe(f.revision);
  });
});
