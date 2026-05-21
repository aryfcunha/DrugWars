// Report generator: reads an experiment directory and emits report.md.
// Usage: npx tsx scripts/ai/analytical/report.ts <experimentId-or-path>

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunSummary, TurnSample } from './telemetry';

// ─── Loaders ──────────────────────────────────────────────────────────────

function resolveDir(arg: string): string {
  const candidates = [
    arg,
    path.resolve('scripts/ai/analytical/runs', arg),
    path.resolve(arg),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'manifest.json'))) return c;
  }
  throw new Error(`Cannot find experiment dir for "${arg}"`);
}

function loadJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as T);
}

// ─── Stats helpers ────────────────────────────────────────────────────────

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
  const results: number[] = [];
  // Deterministic seed for reproducibility
  let s = 0x9E3779B1;
  const rand = () => { s = (s + 0x6D2B79F5) | 0; let r = Math.imul(s ^ (s >>> 15), 1 | s); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < B; i++) {
    const sample = new Array(xs.length);
    for (let j = 0; j < xs.length; j++) sample[j] = xs[(rand() * xs.length) | 0];
    results.push(stat(sample));
  }
  results.sort((a, b) => a - b);
  return { lo: quantile(results, alpha / 2), hi: quantile(results, 1 - alpha / 2) };
}

function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

// ─── ASCII histogram ──────────────────────────────────────────────────────

function histogram(values: number[], bins = 20, width = 50): string[] {
  if (values.length === 0) return ['(empty)'];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [`all = ${money(min)}`];
  const step = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const b = Math.min(bins - 1, Math.floor((v - min) / step));
    counts[b]++;
  }
  const peak = Math.max(...counts);
  const lines: string[] = [];
  for (let i = 0; i < bins; i++) {
    const lo = min + i * step;
    const hi = min + (i + 1) * step;
    const bar = '█'.repeat(Math.round((counts[i] / peak) * width));
    lines.push(`  ${money(lo).padStart(8)}..${money(hi).padEnd(8)} │${bar} ${counts[i]}`);
  }
  return lines;
}

// ─── Trajectory bands ─────────────────────────────────────────────────────

function trajectoryBands(games: { seed: number; samples: TurnSample[] }[], horizon: number): { day: number; p10: number; p50: number; p90: number; n: number }[] {
  const byDay: Record<number, number[]> = {};
  for (const g of games) {
    // Use last sample of each day to capture end-of-day net worth
    const dayMap = new Map<number, number>();
    for (const s of g.samples) dayMap.set(s.day, s.net_worth);
    for (const [day, nw] of dayMap) {
      (byDay[day] ??= []).push(nw);
    }
  }
  const out: { day: number; p10: number; p50: number; p90: number; n: number }[] = [];
  for (let d = 1; d <= horizon; d++) {
    const xs = byDay[d];
    if (!xs || xs.length === 0) continue;
    xs.sort((a, b) => a - b);
    out.push({
      day: d,
      p10: quantile(xs, 0.10),
      p50: quantile(xs, 0.50),
      p90: quantile(xs, 0.90),
      n: xs.length,
    });
  }
  return out;
}

function trajectoryChart(bands: ReturnType<typeof trajectoryBands>, width = 60, height = 12): string[] {
  if (bands.length === 0) return ['(no trajectory data)'];
  const allValues = bands.flatMap(b => [b.p10, b.p50, b.p90]);
  const lo = Math.min(...allValues);
  const hi = Math.max(...allValues);
  if (lo === hi) return [`flat at ${money(lo)}`];
  const norm = (v: number) => Math.round(((v - lo) / (hi - lo)) * (height - 1));
  const grid: string[][] = Array.from({ length: height }, () => new Array(width).fill(' '));
  for (let i = 0; i < bands.length; i++) {
    const x = Math.round((i / Math.max(1, bands.length - 1)) * (width - 1));
    const p10y = (height - 1) - norm(bands[i].p10);
    const p50y = (height - 1) - norm(bands[i].p50);
    const p90y = (height - 1) - norm(bands[i].p90);
    for (let y = Math.min(p10y, p90y); y <= Math.max(p10y, p90y); y++) {
      if (grid[y][x] === ' ') grid[y][x] = '·';
    }
    grid[p50y][x] = '●';
  }
  const lines = grid.map((row, i) => {
    const yVal = hi - (i / (height - 1)) * (hi - lo);
    return `  ${money(yVal).padStart(8)} │${row.join('')}`;
  });
  lines.push(`           └${'─'.repeat(width)}  day 1 → ${bands.length}`);
  return lines;
}

// ─── Action mix ──────────────────────────────────────────────────────────

function actionMix(summaries: RunSummary[]): string[] {
  const totals: Record<string, number> = {};
  let grand = 0;
  for (const s of summaries) {
    for (const [k, v] of Object.entries(s.count_by_macro)) {
      totals[k] = (totals[k] ?? 0) + (v ?? 0);
      grand += v ?? 0;
    }
  }
  if (grand === 0) return ['(no actions)'];
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const lines: string[] = [];
  for (const [k, n] of rows) {
    const pct = (n / grand) * 100;
    const bar = '█'.repeat(Math.round(pct / 2));
    lines.push(`  ${k.padEnd(16)} ${pct.toFixed(1).padStart(5)}% ${bar} (${n})`);
  }
  return lines;
}

// ─── Failure analysis ────────────────────────────────────────────────────

function failureAnalysis(summaries: RunSummary[]): string[] {
  const sorted = [...summaries].sort((a, b) => a.net_worth - b.net_worth);
  const bottomN = Math.max(1, Math.floor(sorted.length / 10));
  const bottom = sorted.slice(0, bottomN);
  const causes: Record<string, number> = {};
  for (const s of bottom) causes[s.cause_of_death] = (causes[s.cause_of_death] ?? 0) + 1;
  const meanPeak = mean(bottom.map(b => b.peak_net_worth));
  const meanPeakDay = mean(bottom.map(b => b.peak_day));
  const meanDaysPlayed = mean(bottom.map(b => b.days_played));
  const meanCops = mean(bottom.map(b => b.cop_encounters));
  const lines: string[] = [
    `  Bottom decile (n=${bottomN}, worst net worth):`,
    `    cause_of_death: ${Object.entries(causes).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `    mean peak NW   = ${money(meanPeak)} (reached on day ${meanPeakDay.toFixed(1)})`,
    `    mean days_lived= ${meanDaysPlayed.toFixed(1)}`,
    `    mean cop encts = ${meanCops.toFixed(2)}`,
  ];
  return lines;
}

// ─── Main report ─────────────────────────────────────────────────────────

export function buildReport(dir: string): string {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const summaries = loadJsonl<RunSummary>(path.join(dir, 'summary.jsonl'));
  const trajectories = loadJsonl<{ seed: number; samples: TurnSample[] }>(path.join(dir, 'trajectories.jsonl'));

  const nws = summaries.map(s => s.net_worth);
  const sortedNW = [...nws].sort((a, b) => a - b);
  const meanNW = mean(nws);
  const ciMean = bootstrapCI(nws, mean);
  const deaths = summaries.filter(s => !s.alive).length;
  const deathRate = deaths / summaries.length;

  const bands = trajectoryBands(trajectories, manifest.horizon);

  const lines: string[] = [];
  lines.push(`# Experiment: ${manifest.experimentId}`);
  lines.push('');
  lines.push(`- agent: **${manifest.agent}**`);
  lines.push(`- horizon: ${manifest.horizon}D ${manifest.mode}`);
  lines.push(`- n: ${manifest.n}`);
  lines.push(`- created: ${manifest.createdAt}`);
  lines.push('');

  lines.push('## Headline');
  lines.push('');
  lines.push('```');
  lines.push(`mean      = ${money(meanNW)}  (95% CI ${money(ciMean.lo)} .. ${money(ciMean.hi)})`);
  lines.push(`p5  = ${money(quantile(sortedNW, 0.05))}`);
  lines.push(`p25 = ${money(quantile(sortedNW, 0.25))}`);
  lines.push(`p50 = ${money(quantile(sortedNW, 0.50))}`);
  lines.push(`p75 = ${money(quantile(sortedNW, 0.75))}`);
  lines.push(`p95 = ${money(quantile(sortedNW, 0.95))}`);
  lines.push(`min = ${money(sortedNW[0])}  max = ${money(sortedNW[sortedNW.length - 1])}`);
  lines.push(`death rate = ${(deathRate * 100).toFixed(1)}% (${deaths}/${summaries.length})`);
  lines.push('```');
  lines.push('');

  lines.push('## Net Worth Distribution');
  lines.push('');
  lines.push('```');
  lines.push(...histogram(nws, 20, 50));
  lines.push('```');
  lines.push('');

  lines.push('## Trajectory (net worth by day, p10/p50/p90)');
  lines.push('');
  lines.push('```');
  lines.push(...trajectoryChart(bands, 60, 12));
  lines.push('```');
  lines.push('');

  lines.push('## Action Mix');
  lines.push('');
  lines.push('```');
  lines.push(...actionMix(summaries));
  lines.push('```');
  lines.push('');

  lines.push('## Money Flow (means)');
  lines.push('');
  lines.push('```');
  const flows = ['total_spent_drugs', 'total_revenue_drugs', 'total_coat_spend', 'total_debt_paid', 'total_deposited', 'total_withdrawn', 'total_gun_accept_spend'] as const;
  for (const k of flows) {
    const v = mean(summaries.map(s => (s as Record<string, number>)[k] as number));
    lines.push(`  ${k.padEnd(28)} ${money(v).padStart(10)}`);
  }
  lines.push(`  ${'mean_peak_net_worth'.padEnd(28)} ${money(mean(summaries.map(s => s.peak_net_worth))).padStart(10)}`);
  lines.push(`  ${'mean_cop_encounters'.padEnd(28)} ${mean(summaries.map(s => s.cop_encounters)).toFixed(2).padStart(10)}`);
  lines.push(`  ${'mean_hp_lost'.padEnd(28)} ${mean(summaries.map(s => s.hp_lost_total)).toFixed(1).padStart(10)}`);
  lines.push(`  ${'mean_events_total'.padEnd(28)} ${mean(summaries.map(s => s.events_total)).toFixed(2).padStart(10)}`);
  lines.push('```');
  lines.push('');

  lines.push('## Failure Analysis');
  lines.push('');
  lines.push('```');
  lines.push(...failureAnalysis(summaries));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

function isMain() {
  const argv1 = process.argv[1]?.replace(/\\/g, '/');
  const url = import.meta.url.replace(/\\/g, '/');
  return argv1 && (url.endsWith(argv1) || url === `file:///${argv1}` || url === `file://${argv1}`);
}

if (isMain()) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npx tsx scripts/ai/analytical/report.ts <experimentId-or-path>');
    process.exit(1);
  }
  const dir = resolveDir(arg);
  const md = buildReport(dir);
  const outPath = path.join(dir, 'report.md');
  fs.writeFileSync(outPath, md);
  console.log(md);
  console.log(`\nWrote ${outPath}`);
}
