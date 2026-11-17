/**
 * Dev-only: reconcile a comic-loop-eval run into one table per PR and arm.
 *
 *   bun scripts/comic-loop-report.ts <run-name>
 *
 * Reads .git/tracetoon/eval/loop/<run>/results.json and each case's
 * C/loop.json; writes reconciliation.md and reconciliation.json beside them.
 * Makes no model or image calls.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../src/util/exec.ts';

const short = (p: string) =>
  existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 8) : '-';

export function reconcile(root: string) {
  const res = JSON.parse(readFileSync(join(root, 'results.json'), 'utf8'));
  const rows: Record<string, unknown>[] = [];
  let slots = 0;
  let generated = 0;
  let firstFails = 0;
  let candidateFails = 0;
  for (const r of res.results) {
    if (r.error) {
      rows.push({ id: r.id, error: r.error });
      continue;
    }
    const loop = JSON.parse(readFileSync(join(root, r.id, 'C', 'loop.json'), 'utf8'));
    const bDir = join(root, r.id, 'B');
    const bNew = existsSync(bDir) ? readdirSync(bDir).filter((d) => d.startsWith('d')).length : 0;
    const cNew = loop.candidates.length - 1;
    slots += 1 + r.B.draws + r.C.renders;
    generated += bNew + cNew;
    const fails = (c: any) =>
      Object.entries(c.check?.gates ?? {})
        .filter(([, g]: any) => g.state !== 'pass')
        .map(([k]) => k);
    if (fails(loop.candidates[0]).length) firstFails++;
    candidateFails += loop.candidates.filter((c: any) => fails(c).length).length;
    const selected = r.C.stop && loop.incumbent;
    rows.push({
      id: r.id,
      A: { sha: short(join(root, '..', '..', 'arms', 'new2', r.id, 'out', 'comic.png')), ...r.final.A },
      B: { sha: short(r.B.image), newImages: bNew, judgeCalls: r.B.judgeCalls, keptOriginal: short(r.B.image) === short(join(root, '..', '..', 'arms', 'new2', r.id, 'out', 'comic.png')), ...r.final.B },
      C: {
        candidates: loop.candidates.map((c: any) => ({
          id: c.id,
          kind: c.kind,
          repair: c.target ?? null,
          sha: c.imageSha256.slice(0, 8),
          amusement: c.observation?.scores?.amusement?.score ?? null,
          failedGates: fails(c),
        })),
        retained: selected || null,
        reportedImage: short(r.C.image),
        newImages: cNew,
        judgeCalls: loop.used.judgeCalls,
        stop: r.C.stop,
        log: loop.log,
        ...r.final.C,
      },
      comparison: { CvsA: r.CvsA, CvsB: r.CvsB },
    });
  }
  return {
    verdict:
      'Promotion rule NOT met: the loop did not beat both other arms on humor without regressions. Kept on record.',
    accounting: {
      armImageSlots: slots,
      newImageGenerations: generated,
      explanation: `Each arm counts its images, but arms B and C reuse the original A image (and C's unchanged candidates), so ${slots} slots needed ${generated} new generations in this run.`,
    },
    failures: {
      firstRenderFailures: firstFails,
      failingCandidates: candidateFails,
      explanation:
        'First-render failures count each PR once (its first image); failing candidates count every image the loop judged, including repairs that still failed.',
    },
    summary: res.summary,
    rows,
  };
}

function markdown(r: ReturnType<typeof reconcile>) {
  const lines = [
    '# Comic loop experiment: reconciliation',
    '',
    `**${r.verdict}**`,
    '',
    `- Image accounting: ${r.accounting.explanation}`,
    `- Failures: ${r.failures.firstRenderFailures} first-render failures; ${r.failures.failingCandidates} failing candidates. ${r.failures.explanation}`,
    `- Judge: ${r.summary.calls.judge.calls} calls, ${r.summary.calls.judge.failed} failed, $${r.summary.calls.judge.cost}. Images: ${r.summary.calls.images.calls}. Drafter: ${r.summary.calls.drafter.calls}.`,
    '- Cache: final assessments reused the loop verdict for the same image (one verdict per image); identical images were not compared.',
    '',
    '| PR | A (sha, amuse, eligible) | B kept original? | C candidates (kind/repair: amuse, failed gates) | C retained | C vs A | C vs B |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const row of r.rows as any[]) {
    if (row.error) {
      lines.push(`| ${row.id} | error: ${row.error} | | | | | |`);
      continue;
    }
    const cands = row.C.candidates
      .map((c: any) => `${c.id} ${c.kind}${c.repair ? `/${c.repair}` : ''}: ${c.amusement ?? '?'}${c.failedGates.length ? ` ✗${c.failedGates.join(',')}` : ' ✓'}`)
      .join('<br>');
    lines.push(
      `| ${row.id} | ${row.A.sha}, ${row.A.amusement}, ${row.A.eligible ? 'yes' : 'no'} | ${row.B.keptOriginal ? 'yes' : 'no'} (${row.B.newImages} new) | ${cands} | ${row.C.retained ?? 'none (reported A image)'} | ${row.comparison.CvsA} | ${row.comparison.CvsB} |`,
    );
  }
  return lines.join('\n') + '\n';
}

if (import.meta.main) {
  const name = process.argv[2];
  if (!name) {
    console.error('Use: comic-loop-report.ts <run-name>');
    process.exit(2);
  }
  const g = git(process.cwd(), ['rev-parse', '--absolute-git-dir']).stdout.trim();
  const root = join(g, 'tracetoon', 'eval', 'loop', name);
  const r = reconcile(root);
  writeFileSync(join(root, 'reconciliation.json'), JSON.stringify(r, null, 2) + '\n');
  writeFileSync(join(root, 'reconciliation.md'), markdown(r));
  console.log(markdown(r));
}
