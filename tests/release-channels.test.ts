// Homebrew and winget manifests come from a release's checksums.txt, and the release
// workflow publishes to npm only after the GitHub release exists, and only with a token.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homebrewFormula } from '../.github/scripts/homebrew-formula.ts';
import { readChecksums, SUPPORTED_TARGETS } from '../.github/scripts/release-assets.ts';
import { IDENTIFIER, wingetManifests } from '../.github/scripts/winget-manifest.ts';
import { npmDistTag, parsePublished } from '../.github/scripts/npm-dist-tag.ts';

const TAG = 'v1.2.3-rc.4';
const BASE = `https://github.com/Tracetoon/tracetoon/releases/download/${TAG}`;
const hashOf = (i: number) => i.toString(16).padStart(2, '0').repeat(32);
const names = [
  'tracetoon-skill.zip',
  ...SUPPORTED_TARGETS.map((t) => `tracetoon-skill-${t}.zip`),
  'tracetoon-windows-x64.exe',
  'candidate-manifest.json',
];
const checksums = names.map((n, i) => `${hashOf(i + 1)}  ${n}`).join('\n') + '\n';
const sumOf = (name: string) => hashOf(names.indexOf(name) + 1);

describe('Homebrew formula', () => {
  const rb = homebrewFormula(checksums, TAG);
  test('each macOS and Linux CPU gets its own release archive and checksum', () => {
    for (const target of ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']) {
      const name = `tracetoon-skill-${target}.zip`;
      // The sha256 sits directly under its own url, inside the same block.
      expect(rb).toContain(`url "${BASE}/${name}"\n      sha256 "${sumOf(name)}"`);
    }
    const mac = rb.slice(rb.indexOf('on_macos do'), rb.indexOf('on_linux do'));
    expect(mac).toMatch(/on_arm do\n\s+url "[^"]+darwin-arm64\.zip"/);
    expect(mac).toMatch(/on_intel do\n\s+url "[^"]+darwin-x64\.zip"/);
    expect(rb).not.toContain('windows');
    expect(rb).toContain('version "1.2.3-rc.4"');
    expect(rb).toContain('class Tracetoon < Formula');
  });
  test('installs the binary with its skill and tests it with build-info', () => {
    expect(rb).toContain('write_env_script binary, TRACETOON_SKILL_DIR: libexec');
    expect(rb).toMatch(/test do\n.*tracetoon build-info --json/);
  });
  test('refuses a missing archive or a non-release tag', () => {
    const partial = checksums
      .split('\n')
      .filter((l) => !l.endsWith('linux-arm64.zip'))
      .join('\n');
    expect(() => homebrewFormula(partial, TAG)).toThrow(
      'tracetoon-skill-linux-arm64.zip',
    );
    expect(() => homebrewFormula(checksums, 'main')).toThrow('Not a release tag');
    expect(() => readChecksums('nonsense')).toThrow('Invalid checksums line');
  });
});

describe('winget manifests', () => {
  const files = wingetManifests(checksums, TAG);
  test('the three multi-file manifests for Tracetoon.Tracetoon, schema 1.12.0', () => {
    expect(Object.keys(files).sort()).toEqual(
      [
        `${IDENTIFIER}.installer.yaml`,
        `${IDENTIFIER}.locale.en-US.yaml`,
        `${IDENTIFIER}.yaml`,
      ].sort(),
    );
    for (const [name, text] of Object.entries(files)) {
      expect(text).toContain('PackageIdentifier: Tracetoon.Tracetoon\n');
      expect(text).toContain('PackageVersion: "1.2.3-rc.4"\n');
      expect(text).toContain('ManifestVersion: 1.12.0\n');
      const type = name.endsWith('.installer.yaml')
        ? 'installer'
        : name.includes('.locale.')
          ? 'defaultLocale'
          : 'version';
      expect(text).toContain(`ManifestType: ${type}\n`);
      expect(text).toContain(
        `$schema=https://aka.ms/winget-manifest.${type}.1.12.0.schema.json`,
      );
    }
  });
  test('the installer is the Windows release archive with its checksum, as a portable command', () => {
    const installer = files[`${IDENTIFIER}.installer.yaml`]!;
    const name = 'tracetoon-skill-windows-x64.zip';
    expect(installer).toContain(
      `  InstallerUrl: ${BASE}/${name}\n  InstallerSha256: ${sumOf(name).toUpperCase()}\n`,
    );
    expect(installer).toContain('InstallerType: zip\nNestedInstallerType: portable\n');
    expect(installer).toContain(
      '- RelativeFilePath: "tracetoon\\\\bin\\\\tracetoon-windows-x64.exe"\n  PortableCommandAlias: tracetoon\n',
    );
    expect(files[`${IDENTIFIER}.locale.en-US.yaml`]).toContain('License: Apache-2.0\n');
  });
});

describe('npm dist-tag', () => {
  test('release candidates go to latest until a final version is on npm, then to next', () => {
    expect(npmDistTag('1.0.0-rc.36', [])).toBe('latest');
    expect(npmDistTag('1.0.0-rc.36', ['0.0.0-stage', '1.0.0-rc.34', '1.0.0-rc.35'])).toBe(
      'latest',
    );
    expect(npmDistTag('1.0.1-rc.1', ['1.0.0-rc.35', '1.0.0'])).toBe('next');
    expect(npmDistTag('1.0.0', ['1.0.0-rc.35'])).toBe('latest');
    expect(npmDistTag('1.0.1', ['1.0.0'])).toBe('latest');
  });
  test('reads npm view --json output: an array, one bare version, or nothing', () => {
    expect(parsePublished('["1.0.0-rc.34","1.0.0-rc.35"]')).toEqual([
      '1.0.0-rc.34',
      '1.0.0-rc.35',
    ]);
    expect(parsePublished('"1.0.0-rc.34"')).toEqual(['1.0.0-rc.34']);
    expect(parsePublished('')).toEqual([]);
    expect(() => parsePublished('{"error":{"code":"E404"}}')).toThrow();
  });
});

describe('release workflow', () => {
  const wf = readFileSync(
    join(import.meta.dir, '..', '.github/workflows/release.yml'),
    'utf8',
  );
  const at = (s: string) => {
    const i = wf.indexOf(s);
    expect(i).toBeGreaterThanOrEqual(0);
    return i;
  };
  test('npm packages are built from the verified assets before the release and published after it', () => {
    expect(at('release-assets.ts verify')).toBeLessThan(
      at('.github/scripts/npm-packages.ts'),
    );
    expect(at('.github/scripts/npm-packages.ts')).toBeLessThan(at('gh release create'));
    expect(at('gh release create')).toBeLessThan(at('npm publish'));
    expect(wf).toContain(
      'npm publish "$dir" --provenance --access public --tag "$dist_tag"',
    );
    expect(wf).toContain(
      'dist_tag=$(bun .github/scripts/npm-dist-tag.ts "${GITHUB_REF_NAME#v}" "$published")',
    );
    expect(wf).toContain('id-token: write');
    // Tags promote; they never compile.
    expect(wf).not.toMatch(/scripts\/build\.ts|bun run (build|bundle)|bun build/);
  });
  test('without the NPM_PUBLISH variable the npm steps are skipped with a notice', () => {
    expect(wf).toContain('NPM_PUBLISH: ${{ vars.NPM_PUBLISH }}');
    const publish = wf.slice(at('- name: Publish the npm packages'), at('\n  channels:'));
    expect(publish).toContain("if: env.NPM_PUBLISH != ''");
    const skip = wf.slice(at('- name: Skip npm'), at('- uses: actions/setup-node'));
    expect(skip).toContain("if: env.NPM_PUBLISH == ''");
    expect(skip).toContain('::notice');
  });
  test('the MCP Registry job waits for the npm version before publishing', () => {
    const mcp = wf.slice(at('\n  mcp-registry:'));
    expect(mcp.indexOf('npm view "tracetoon@$version" version')).toBeGreaterThan(0);
    expect(mcp.indexOf('npm view "tracetoon@$version" version')).toBeLessThan(
      mcp.indexOf('./mcp-publisher publish'),
    );
  });
  test('npm publishes by trusted publishing: OIDC, a new enough npm, a GitHub-hosted runner', () => {
    const release = wf.slice(at('\n  release:'), at('\n  channels:'));
    expect(release).toContain('runs-on: ubuntu-latest');
    expect(wf).toMatch(/^permissions:[\s\S]*?id-token: write/m);
    const npm = release.match(/npm install -g npm@(\d+\.\d+\.\d+)/)?.[1] ?? '0.0.0';
    // npm 11.5.1 is the first release that supports trusted publishing.
    expect(Bun.semver.order(npm, '11.5.1')).toBeGreaterThanOrEqual(0);
    expect(at('npm install -g npm@')).toBeLessThan(at('npm publish "$dir"'));
    expect(release).toMatch(/node-version: (2[4-9]|[3-9]\d)/);
  });
  test('Homebrew and winget files are generated from the published checksums and attached, not pushed', () => {
    const channels = wf.slice(at('\n  channels:'));
    expect(channels).toContain('needs: release');
    expect(channels).toContain('--pattern checksums.txt');
    expect(channels).toContain('homebrew-formula.ts');
    expect(channels).toContain('winget-manifest.ts');
    expect(channels).toContain('gh release upload');
    expect(channels).toContain('tracetoon.rb');
    expect(channels).toContain('winget-manifests.zip');
    expect(channels).not.toMatch(/git push|homebrew-tap|winget-pkgs|gh pr create/);
  });
});
