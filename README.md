<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Tracetoon/tracetoon/main/docs/brand/tracetoon-lockup-dark.svg">
  <img src="https://raw.githubusercontent.com/Tracetoon/tracetoon/main/docs/brand/tracetoon-lockup.svg" alt="Tracetoon" height="64">
</picture>

# tracetoon.ai site (gh-pages branch)

This branch is the website at https://tracetoon.ai. The code and docs live on `main`; do not put site files there.

## Pages

- `index.html`: the landing page. Plain HTML with inline CSS and one small inline script for the install tabs and copy buttons. The page still works with JavaScript off. No build step. Its headline figures come from `vs-native.html`, and its graph figures (82% vs 72%, the method tables) from `evidence-graph-61.html`.
- `results.html`: a redirect to `prbench.html#results`, kept so older links (the README on `main`, the site kit's `index.md`) still land on the results.
- `vs-native.html`: Tracetoon vs your agent alone (61 real PRs, Opus 5.5 and Sol 6.1), the flagship report.
- `evidence-graph-61.html`: the evidence graph vs Tracetoon's original workflow on 61 real PRs.
- `evidence-graph.html`: the first, 5-PR evidence graph study, kept as an archive. Mermaid loads from jsDelivr.
- `prbench.html`: the Benchmark page, linked as "Benchmark" from every page's top bar. It explains prbench, then `#results` lists every report newest first (a comic, a short summary and the headline figures of each, with all three runs' tables in a "side by side" panel), then how to run it and what it costs. When you publish a new report, add a card at the top of `#results` and move the "Newest" tag.

The three report pages are exports of the articles with the site top bar and an "All results" link added. Every page shares the same top bar CSS: content grows to 1600px (1840px and 2500px with larger type on very wide screens) and running text stays near 70 characters a line.

## Agent files

These come from the `tracetoon-site-kit.zip` attached to each Tracetoon release (`scripts/site-kit.ts` on `main`); this copy is from 1.0.0-rc.50. Don't edit them here; after a release, download the kit and copy the same files over.

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

A figure on the landing page or `prbench.html` must match the report it comes from. If you change one, change all of them: `index.html`, `prbench.html`, the report page, and the README on `main` (its headline block is generated from `RESULTS` in `scripts/agent-surfaces.ts`).

## Images

- `img/hero.webp`: the "No more PR slop" top image (from `docs/tracetoon-hero.png` on `main`).
- `img/comic-*.webp`: one comic per landing section (quality, graph, embedded, cost, workflow, pr17), plus one per results page: `comic-results` (the Benchmark page's results), `comic-vs-native`, `comic-graph-61`, and `comic-cost` (also the 5-PR report). To swap one, keep the file name, or update the `src`, `width`, `height` and `alt` in `index.html`. Use WebP at about 1400 px wide and under 250 KB: `cwebp -q 80 -resize 1400 0 in.png -o img/comic-x.webp`.
- `img/og-image.png`: the 1200×630 card shown when the landing page is shared, with the Tracetoon logo on a comic panel.
- `img/og-*.jpg`: the share cards for `prbench.html` (`og-results.jpg`) and each report (JPEG, because some link previews don't read WebP).
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
