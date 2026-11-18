# Release channels

A `v*` tag promotes a verified CI artifact set (`.github/workflows/release.yml`).
Every channel below repackages those exact bytes; none compiles anything.

| Channel                                                       | Made by                               | Published by the workflow?                   |
| ------------------------------------------------------------- | ------------------------------------- | -------------------------------------------- |
| GitHub release assets                                         | CI `candidate-assets` job             | yes, `gh release create`                     |
| `release` branch (Claude Code plugin, skills CLI, `gh skill`) | `.github/scripts/release-branch.ts`   | yes                                          |
| npm: `tracetoon` and `@tracetoon/cli-<platform>-<arch>`       | `.github/scripts/npm-packages.ts`     | only when the `NPM_PUBLISH` variable is set  |
| Homebrew formula `tracetoon.rb`                               | `.github/scripts/homebrew-formula.ts` | attached to the release; not pushed to a tap |
| winget manifests `winget-manifests.zip`                       | `.github/scripts/winget-manifest.ts`  | attached to the release; not submitted       |

## npm

The release job builds the packages from the verified assets before
`gh release create`, so a bad set fails before anything is public, and
publishes them after it: the five platform packages first, then the wrapper
whose `optionalDependencies` pin them to the same version. Tags with a `-`
(release candidates) go to the `next` dist-tag, others to `latest`. Versions
already on npm are skipped, so rerunning the job finishes a partial publish.
Without the `NPM_PUBLISH` repository variable the steps are skipped with a
notice and the release still succeeds.

The job publishes with npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers): npm trades
the run's GitHub OIDC token for a one-off publish token, so the repository
keeps no long-lived npm secret, and every package carries npm provenance. It
needs `id-token: write`, a GitHub-hosted runner and npm 11.5.1 or later; the
workflow installs a pinned npm on Node 24.

- `@tracetoon/cli-linux-x64`, `-linux-arm64`, `-darwin-x64`, `-darwin-arm64`,
  `-win32-x64`: the release binary in `bin/`, with `os`/`cpu` so npm installs
  only the matching one. No install scripts (Bun blocks them).
- `tracetoon`: `bin/tracetoon.js` (Node 18+ or Bun, no dependencies) finds the
  platform package, sets `TRACETOON_SKILL_DIR` to the skill it ships in
  `skill/tracetoon/` (the verified `tracetoon-skill.zip` contents), runs the
  binary and passes its exit code and signals through. A missing platform
  package exits 3 with other ways to install.

To try a build locally, from an extracted, verified artifact set:

```sh
unzip -q release/tracetoon-skill.zip -d /tmp/skill
bun .github/scripts/npm-packages.ts release /tmp/skill/tracetoon /tmp/npm
(cd /tmp/npm/tracetoon && npm pack --dry-run)
```

Owner setup, once. npm can only trust a package that already exists, so the
first release publishes another way and trusted publishing takes over after.
The six packages first went out with rc.34, published by hand from the
verified release assets, so for Tracetoon only steps 4 to 6 remain:

1. Create the npm organization `tracetoon` (for the `@tracetoon` scope) and
   make sure the unscoped name `tracetoon` is still free (it was in Nov 2026).
   Turn on two-factor authentication for your npm account (`npm trust` needs
   it).
2. First publish: either a granular access token with read and write access
   to all packages and the `tracetoon` organization, a 7-day expiry and
   "bypass two-factor authentication" ticked (without it the job fails with
   `EOTP`), added as the `NPM_TOKEN` repository secret; or publish the
   packages by hand from the release assets (the commands above, then
   `npm publish <dir> --access public --tag next` for each, platform
   packages first). Set the variable either way:
   `gh variable set NPM_PUBLISH --body 1 --repo Tracetoon/tracetoon`.
   A brand-new package can show only a `0.0.0-stage` placeholder for a few
   minutes after its first publish; wait before retrying.
3. Tag the release.
4. On the day you tag the next release, trust the workflow for each package.
   A new trust configuration expires 48 hours after it is created unless a
   publish uses it, and an expired one can only be deleted and recreated, so
   don't set it up ahead of time. It needs npm 11.15 or later
   (`npm i -g npm@latest`) and `npm login`:

   ```sh
   for p in tracetoon @tracetoon/cli-linux-x64 @tracetoon/cli-linux-arm64 \
            @tracetoon/cli-darwin-x64 @tracetoon/cli-darwin-arm64 @tracetoon/cli-win32-x64; do
     npm trust github "$p" --repo Tracetoon/tracetoon --file release.yml --allow-publish --yes
     sleep 2
   done
   ```

   `--allow-publish` is required: the workflow runs `npm publish`, and npm
   refuses to create a configuration without a permission flag. The first
   call asks for two-factor authentication; tick "skip for the next 5
   minutes" so the rest go through. `npm trust list <package>` shows each
   one. (The same form is under each package's Settings → Trusted publishing:
   GitHub Actions, `Tracetoon`, `tracetoon`, `release.yml`, no environment,
   direct publish allowed.)

5. Remove any token: `gh secret delete NPM_TOKEN --repo Tracetoon/tracetoon`
   and revoke it on npmjs.com (done for Tracetoon after rc.34). After the
   first trusted publish, for each package, Settings → Publishing access →
   "Require two-factor authentication and disallow tokens", so only this
   workflow can publish.
6. After the first publish, `npx tracetoon@latest setup` works; the agent docs
   (`docs/agents/install.md`) already list it first. Release candidates go to
   the `next` dist-tag; if `npm view tracetoon dist-tags` shows no `latest`,
   run `npm dist-tag add tracetoon@<version> latest`.

A package added later (a new platform) must be published once by hand, or with
a token again, before it can be trusted.

## Homebrew

The `channels` job downloads the published `checksums.txt`, writes
`tracetoon.rb` and attaches it to the release. The formula installs
`tracetoon-skill-<target>.zip` (the skill with that platform's binary) for
macOS and Linux on arm64 and x64, runs the binary through an env script that
sets `TRACETOON_SKILL_DIR` so `tracetoon setup` can install the skill, and
tests it with `tracetoon build-info --json`.

Next step (manual until automated):

1. Create the public repository `Tracetoon/homebrew-tap` with a `Formula/`
   folder.
2. Per release: `gh release download vX.Y.Z -R Tracetoon/tracetoon -p tracetoon.rb`,
   commit it as `Formula/tracetoon.rb`, and check it with
   `brew install --build-from-source ./Formula/tracetoon.rb && brew test tracetoon && brew audit --strict tracetoon`.
3. Users then run `brew install tracetoon/tap/tracetoon`.

To automate it, add a token with `contents: write` on the tap repository as a
secret and a step in the `channels` job that pushes the formula there.

## winget

The same job writes the three manifests (version, installer, defaultLocale;
schema 1.12.0) for `Tracetoon.Tracetoon` in the winget-pkgs layout
(`manifests/t/Tracetoon/Tracetoon/<version>/`) and attaches them as
`winget-manifests.zip`. The installer is `tracetoon-skill-windows-x64.zip` as a
zip with a nested portable `tracetoon` command.

Next step (manual until automated):

1. Check them locally: `winget validate --manifest <folder>` and
   `winget install --manifest <folder>`.
2. Submit them as a pull request to `microsoft/winget-pkgs` (by hand, or with
   `wingetcreate submit <folder>`). winget-pkgs reviewers may not accept
   pre-release versions; submit a stable release first.
3. To automate later, a fork of winget-pkgs and a token for it let the
   `channels` job run `wingetcreate submit` (or `vedantmgoyal9/winget-releaser`).
