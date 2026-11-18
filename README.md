<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Tracetoon/tracetoon/main/docs/brand/tracetoon-lockup-dark.svg">
  <img src="https://raw.githubusercontent.com/Tracetoon/tracetoon/main/docs/brand/tracetoon-lockup.svg" alt="Tracetoon" height="64">
</picture>

# tracetoon.ai site (gh-pages branch)

This branch is the website at https://tracetoon.ai. The code and docs live on `main`; do not put site files there.

## Pages

- `index.html`: the landing page. Plain HTML with inline CSS and one small inline script for the install tabs and copy buttons. The page still works with JavaScript off. No build step.
- `evidence-graph.html`: the evidence graph results write-up, linked from the landing page as "Results". It is an export of the article with a site nav bar added. Mermaid loads from jsDelivr.

## Agent files

These come from the `tracetoon-site-kit.zip` attached to each Tracetoon release (`scripts/site-kit.ts` on `main`); this copy is from 1.0.0-rc.36. Don't edit them here; after a release, download the kit and copy the same files over.

- `llms.txt`, `llms-full.txt`: the index agents read first, and the same pages inlined.
- `index.md`, `agents.md`, `skill.md`, `docs/agents/*.md`: markdown versions of the pages, for agents.
- `robots.txt`, `sitemap-agents.xml`: welcome AI crawlers by name and list the files above.
- `.well-known/agent-skills/`: the experimental skill index and the skill archive it names (`.nojekyll` lets GitHub Pages serve the dot folder).
- `brand/tracetoon-icon-512.png`, `brand/tracetoon-social.png`: the images the JSON-LD names.
- In `index.html`'s `<head>`: the `llms.txt` and `index.md` alternate links and the two JSON-LD blocks from the kit's `head.html` (`SoftwareApplication` and `FAQPage`). The "Problems it solves" section shows the same questions and answers as the `FAQPage` block, as search engines require; change them together.

GitHub Pages can't answer `Accept: text/markdown`, so agents find the markdown through the alternate links and `llms.txt`.

## Edit a page

1. Open the file on this branch in the GitHub web editor (pencil icon), or clone the repo and `git checkout gh-pages`.
2. Change the text or HTML.
3. Commit directly to `gh-pages`. GitHub rebuilds the site in about a minute; check Actions > "pages build and deployment".

Every number on the landing page comes from `evidence-graph.html` (round 23, the shipped build). If you change one, change both.

## Images

- `img/hero.webp`: the "No more PR slop" top image (from `docs/tracetoon-hero.png` on `main`).
- `img/comic-*.webp`: one comic per section (quality, graph, embedded, cost, workflow, pr17). To swap one, keep the file name, or update the `src`, `width`, `height` and `alt` in `index.html`. Use WebP at about 1400 px wide and under 250 KB: `cwebp -q 80 -resize 1400 0 in.png -o img/comic-x.webp`.
- `img/og-image.png`: the 1200×630 card shown when the link is shared, with the Tracetoon logo on a comic panel.
- `img/tracetoon-wordmark.svg`: the "Tracetoon" wordmark in the top bar.
- `favicon.svg`: the logo icon (a POW burst with a checkmark), also used in the top bar. Its impact lines turn cream in dark mode.
- `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and `site.webmanifest`: the browser tab, iOS home screen and app install icons.

Every logo file comes from the logo kit in [`docs/brand`](https://github.com/Tracetoon/tracetoon/tree/main/docs/brand) on `main`, which `bun scripts/brand.ts` generates. To change one, regenerate it there and copy it here; don't edit it on this branch.

## Do not delete

- `CNAME`: tells GitHub the site's domain. Removing it takes tracetoon.ai offline.
- `.nojekyll`: keeps GitHub from processing the files.
- `tracetoon-hero.png`: the original top image. Older links may point to it.

## Where the domain is managed

DNS is on Cloudflare and the registration is at Namecheap; both are managed by the homelab, not from this repo. To change records, ask Stephen.
