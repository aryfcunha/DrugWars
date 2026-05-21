// Pairwise paired-seed comparison between two experiments.
// Usage: npx tsx scripts/ai/analytical/diff.ts <expA> <expB>

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunSummary } from './telemetry';

function resolveDir(arg: string): string {
  const candidates = [arg, path.resolve('scripts/ai/analytical/runs', arg), path.resolve(arg)];
  for (const c of candidates) if (fs.existsSync(path.join(c, 'manifest.json'))) return c;
  throw new Error(`Cannot find experiment dir for "${arg}"`);
}

function loadJsonl<T>(file: string): T[] {
  return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as T);
}

function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function bootstrapCI(xs: number[], stat: (a: number[]) => number, B = 1000, alpha = 0.05): { lo: number; hi: number } {
  if (xs.length === 0) return { lo: 0, hi: 0 };
  let s = 0x9E3779B1;
  const rand = () => { s = (s + 0x6D2B79F5) | 0; let r = Math.imul(s ^ (s >>> 15), 1 | s); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  const out: number[] = [];
  for (let i = 0; i < B; i++) {
    const samp = new Array(xs.length);
    for (let j = 0; j < xs.length; j++) samp[j] = xs[(rand() * xs.length) | 0];
    out.push(stat(samp));
  }
  out.sort((a, b) => a - b);
  return { lo: quantile(out, alpha / 2), hi: quantile(out, 1 - alpha / 2) };
}

export function buildDiff(dirA: string, dirB: string): string {
  const mA = JSON.parse(fs.readFileSync(path.join(dirA, 'manifest.json'), 'utf8'));
  const mB = JSON.parse(fs.readFileSync(path.join(dirB, 'manifest.json'), 'utf8'));
  const sA = loadJsonl<RunSummary>(path.join(dirA, 'summary.jsonl'));
  const sB = loadJsonl<RunSummary>(path.join(dirB, 'summary.jsonl'));

  // Pair by seed
  const mapA = new Map(sA.map(s => [s.seed, s]));
  const mapB = new Map(sB.map(s => [s.seed, s]));
  const pairedSeeds: number[] = [];
  for (const seed of mapA.keys()) if (mapB.has(seed)) pairedSeeds.push(seed);

  const deltas = pairedSeeds.map(seed => mapA.get(seed)!.net_worth - mapB.get(seed)!.net_worth);
  const wins = deltas.filter(d => d > 0).length;
  const losses = deltas.filter(d => d < 0).length;
  const ties = deltas.filter(d => d === 0).length;

  const meanDelta = mean(deltas);
  const ciDelta = bootstrapCI(deltas, mean);

  const allA = sA.map(s => s.net_worth).sort((a, b) => a - b);
  const allB = sB.map(s => s.net_worth).sort((a, b) => a - b);

  const lines: string[] = [];
  lines.push(`# Diff: ${mA.experimentId} vs ${mB.experimentId}`);
  lines.push('');
  lines.push(`- A: **${mA.agent}** n=${mA.n}`);
  lines.push(`- B: **${mB.agent}** n=${mB.n}`);
  lines.push(`- paired seeds: ${pairedSeeds.length}`);
  lines.push('');

  lines.push('## Headline Comparison');
  lines.push('');
  lines.push('```');
  lines.push(`              ${'A'.padStart(12)}  ${'B'.padStart(12)}  ${'A − B'.padStart(12)}`);
  for (const [name, q] of [['mean', null], ['p5', 0.05], ['p25', 0.25], ['p50', 0.50], ['p75', 0.75], ['p95', 0.95]] as const) {
    const a = q === null ? mean(allA) : quantile(allA, q);
    const b = q === null ? mean(allB) : quantile(allB, q);
    lines.push(`  ${name.padEnd(10)}  ${money(a).padStart(12)}  ${money(b).padStart(12)}  ${money(a - b).padStart(12)}`);
  }
  const dA = sA.filter(s => !s.alive).length / sA.length;
  const dB = sB.filter(s => !s.alive).length / sB.length;
  lines.push(`  death_rate  ${(dA * 100).toFixed(1).padStart(11)}%  ${(dB * 100).toFixed(1).padStart(11)}%  ${((dA - dB) * 100).toFixed(1).padStart(11)}%`);
  lines.push('```');
  lines.push('');

  lines.push('## Paired Comparison');
  lines.push('');
  lines.push('```');
  lines.push(`paired n         = ${pairedSeeds.length}`);
  lines.push(`A wins           = ${wins}  (${((wins / pairedSeeds.length) * 100).toFixed(1)}%)`);
  lines.push(`B wins           = ${losses}  (${((losses / pairedSeeds.length) * 100).toFixed(1)}%)`);
  lines.push(`ties             = ${ties}`);
  lines.push(`mean (A − B)     = ${money(meanDelta)}  (95% CI ${money(ciDelta.lo)} .. ${money(ciDelta.hi)})`);
  const significant = (ciDelta.lo > 0 || ciDelta.hi < 0) ? '*** SIGNIFICANT ***' : '(CI crosses 0)';
  lines.push(`signif.          = ${significant}`);
  lines.push('```');
  lines.push('');

  // Distribution-shape diff: sort deltas, show where biggest changes are
  const sortedDeltas = [...deltas].sort((a, b) => a - b);
  lines.push('## Where the differences live (sorted Δ = A − B per paired seed)');
  lines.push('');
  lines.push('```');
  lines.push(`  worst Δ (B beats A by most): ${money(sortedDeltas[0])}`);
  lines.push(`  Δ p10  = ${money(quantile(sortedDeltas, 0.10))}`);
  lines.push(`  Δ p25  = ${money(quantile(sortedDeltas, 0.25))}`);
  lines.push(`  Δ p50  = ${money(quantile(sortedDeltas, 0.50))}`);
  lines.push(`  Δ p75  = ${money(quantile(sortedDeltas, 0.75))}`);
  lines.push(`  Δ p90  = ${money(quantile(sortedDeltas, 0.90))}`);
  lines.push(`  best Δ (A beats B by most):  ${money(sortedDeltas[sortedDeltas.length - 1])}`);
  lines.push('```');
  lines.push('');

  // Action mix delta
  lines.push('## Action Mix Δ (A − B, as % of all turns)');
  lines.push('');
  lines.push('```');
  const mixA = computeMix(sA);
  const mixB = computeMix(sB);
  const keys = new Set([...Object.keys(mixA), ...Object.keys(mixB)]);
  const rows = Array.from(keys).map(k => ({ k, dA: mixA[k] ?? 0, dB: mixB[k] ?? 0 })).sort((a, b) => Math.abs(b.dA - b.dB) - Math.abs(a.dA - a.dB));
  for (const { k, dA, dB } of rows) {
    const delta = dA - dB;
    if (Math.abs(delta) < 0.005) continue;
    const marker = delta > 0 ? '+' : '';
    lines.push(`  ${k.padEnd(16)} A=${(dA * 100).toFixed(1).padStart(5)}%  B=${(dB * 100).toFixed(1).padStart(5)}%  Δ=${marker}${(delta * 100).toFixed(1)}%`);
  }
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

function computeMix(summaries: RunSummary[]): Record<string, number> {
  const totals: Record<string, number> = {};
  let grand = 0;
  for (const s of summaries) {
    for (const [k, v] of Object.entries(s.count_by_macro)) {
      totals[k] = (totals[k] ?? 0) + (v ?? 0);
      grand += v ?? 0;
    }
  }
  if (grand === 0) return totals;
  for (const k of Object.keys(totals)) totals[k] /= grand;
  return totals;
}

function isMain() {
  const argv1 = process.argv[1]?.replace(/\\/g, '/');
  const url = import.meta.url.replace(/\\/g, '/');
  return argv1 && (url.endsWith(argv1) || url === `file:///${argv1}` || url === `file://${argv1}`);
}

if (isMain()) {
  const [a, b] = process.argv.slice(2);
  if (!a || !b) {
    console.error('Usage: npx tsx scripts/ai/analytical/diff.ts <expA> <expB>');
    process.exit(1);
  }
  const dirA = resolveDir(a);
  const dirB = resolveDir(b);
  const md = buildDiff(dirA, dirB);
  console.log(md);
  const outPath = path.join(dirA, `diff-vs-${path.basename(dirB)}.md`);
  fs.writeFileSync(outPath, md);
  console.log(`\nWrote ${outPath}`);
}
