// Pareto sweep harness — runs many StrategyConfig variants and prints a table
// of mean / p50 / p95 / max / death rate. Highlights Pareto-optimal configs.
//
// Usage:
//   npx tsx scripts/ai/analytical/sweep.ts [--days 30] [--n 500]

import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeAnalyticalAgent } from './agent';
import { DEFAULT_CONFIG, type StrategyConfig } from './config';
import { buildCombatTable, type CombatTable } from './combat';
import { runOne } from './telemetry';
import { greedyAgent } from '../agents';

function loadCombatTable(): CombatTable {
  const p = path.resolve('scripts/ai/runs/combat_table.json');
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = buildCombatTable();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(t));
  return t;
}

interface Variant {
  name: string;
  config?: Partial<StrategyConfig>;
  isGreedy?: boolean;
}

interface Stats {
  name: string;
  mean: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  max: number;
  deaths: number;
  n: number;
}

function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}

function statsFor(name: string, nws: number[], deaths: number): Stats {
  const sorted = [...nws].sort((a, b) => a - b);
  const mean = nws.reduce((a, b) => a + b, 0) / nws.length;
  return {
    name,
    mean,
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.50),
    p75: quantile(sorted, 0.75),
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    deaths,
    n: nws.length,
  };
}

function money(n: number): string {
  const s = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}k`;
  return `${s}$${Math.round(a)}`;
}

function isParetoOptimal(s: Stats, all: Stats[]): boolean {
  // Pareto on (mean, p95, max, -deaths) — higher is better for first three, lower for deaths
  for (const o of all) {
    if (o === s) continue;
    const dominates =
      o.mean >= s.mean && o.p95 >= s.p95 && o.max >= s.max && o.deaths <= s.deaths &&
      (o.mean > s.mean || o.p95 > s.p95 || o.max > s.max || o.deaths < s.deaths);
    if (dominates) return false;
  }
  return true;
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).flatMap((a, i, arr) => a.startsWith('--') ? [[a.slice(2), arr[i + 1] ?? 'true']] : [])
  );
  const days = parseInt(String(args.days ?? 30), 10);
  const n = parseInt(String(args.n ?? 500), 10);
  const seedOffset = parseInt(String(args['seed-offset'] ?? 1000), 10);

  const combatTable = loadCombatTable();
  const seeds = Array.from({ length: n }, (_, i) => seedOffset + i);

  // ── Variants to test ──
  const variants: Variant[] = [
    { name: 'greedy', isGreedy: true },
    { name: 'v6-baseline', config: {} },
    { name: 'user-thresholds (pure)',
      config: { buyMode: 'user-threshold', sellMode: 'user-threshold' } },
    { name: 'user-thresh + JIT',
      config: { buyMode: 'user-threshold', sellMode: 'user-threshold', jitCoats: true } },
    { name: 'user-thresh + JIT + early-cmpd',
      config: { buyMode: 'user-threshold', sellMode: 'user-threshold', jitCoats: true, earlyCompoundCoats: true } },
    // Uniform percentile sweep (buyP, sellP)
    { name: 'unif (0.20/0.60)', config: { buyMode: 'uniform-percentile', sellMode: 'uniform-percentile', uniformBuyPercentile: 0.20, uniformSellPercentile: 0.60 } },
    { name: 'unif (0.20/0.70)', config: { buyMode: 'uniform-percentile', sellMode: 'uniform-percentile', uniformBuyPercentile: 0.20, uniformSellPercentile: 0.70 } },
    { name: 'unif (0.30/0.70)', config: { buyMode: 'uniform-percentile', sellMode: 'uniform-percentile', uniformBuyPercentile: 0.30, uniformSellPercentile: 0.70 } },
    { name: 'unif (0.30/0.80)', config: { buyMode: 'uniform-percentile', sellMode: 'uniform-percentile', uniformBuyPercentile: 0.30, uniformSellPercentile: 0.80 } },
    { name: 'unif (0.40/0.70)', config: { buyMode: 'uniform-percentile', sellMode: 'uniform-percentile', uniformBuyPercentile: 0.40, uniformSellPercentile: 0.70 } },
    { name: 'unif (0.40/0.80)', config: { buyMode: 'uniform-percentile', sellMode: 'uniform-percentile', uniformBuyPercentile: 0.40, uniformSellPercentile: 0.80 } },
    { name: 'unif (0.50/0.80)', config: { buyMode: 'uniform-percentile', sellMode: 'uniform-percentile', uniformBuyPercentile: 0.50, uniformSellPercentile: 0.80 } },
    // Best uniform + JIT
    { name: 'unif (0.30/0.70) + JIT', config: { buyMode: 'uniform-percentile', sellMode: 'uniform-percentile', uniformBuyPercentile: 0.30, uniformSellPercentile: 0.70, jitCoats: true } },
    { name: 'unif (0.30/0.80) + JIT', config: { buyMode: 'uniform-percentile', sellMode: 'uniform-percentile', uniformBuyPercentile: 0.30, uniformSellPercentile: 0.80, jitCoats: true } },
    { name: 'unif (0.40/0.80) + JIT + early', config: { buyMode: 'uniform-percentile', sellMode: 'uniform-percentile', uniformBuyPercentile: 0.40, uniformSellPercentile: 0.80, jitCoats: true, earlyCompoundCoats: true } },
  ];

  console.log(`Pareto sweep: ${variants.length} variants × ${n} seeds × ${days}D`);
  const allStats: Stats[] = [];
  const t0 = Date.now();
  for (const v of variants) {
    const cfg: StrategyConfig = { ...DEFAULT_CONFIG, ...(v.config ?? {}) };
    const agent = v.isGreedy ? greedyAgent() : makeAnalyticalAgent({ combatTable, config: cfg });
    const nws: number[] = [];
    let deaths = 0;
    for (const seed of seeds) {
      const trace = runOne(agent, seed, days, 'fixed', '', { collectTrajectory: false, collectDecisions: false });
      nws.push(trace.summary.net_worth);
      if (!trace.summary.alive) deaths++;
    }
    const s = statsFor(v.name, nws, deaths);
    allStats.push(s);
    console.log(`  ${v.name.padEnd(36)} mean=${money(s.mean).padStart(10)} p50=${money(s.p50).padStart(8)} p95=${money(s.p95).padStart(10)} max=${money(s.max).padStart(10)} deaths=${s.deaths}/${s.n}`);
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nDone in ${dt}s\n`);

  // ── Pareto frontier ──
  const pareto = allStats.filter(s => isParetoOptimal(s, allStats));
  console.log('─── Pareto frontier (no variant dominates these on mean/p95/max/-deaths) ───');
  console.log(`${'name'.padEnd(36)} ${'mean'.padStart(10)} ${'p50'.padStart(8)} ${'p95'.padStart(10)} ${'max'.padStart(10)} deaths`);
  pareto.sort((a, b) => b.max - a.max);
  for (const s of pareto) {
    console.log(`  ${s.name.padEnd(36)} ${money(s.mean).padStart(10)} ${money(s.p50).padStart(8)} ${money(s.p95).padStart(10)} ${money(s.max).padStart(10)}  ${s.deaths}/${s.n}`);
  }

  // ── Best by each objective ──
  console.log('\n─── Best by objective ───');
  const byMean = [...allStats].sort((a, b) => b.mean - a.mean)[0];
  const byP95 = [...allStats].sort((a, b) => b.p95 - a.p95)[0];
  const byMax = [...allStats].sort((a, b) => b.max - a.max)[0];
  const bySurvival = [...allStats].sort((a, b) => a.deaths - b.deaths)[0];
  console.log(`  best mean:     ${byMean.name.padEnd(36)} mean=${money(byMean.mean)}`);
  console.log(`  best p95:      ${byP95.name.padEnd(36)} p95=${money(byP95.p95)}`);
  console.log(`  best max:      ${byMax.name.padEnd(36)} max=${money(byMax.max)}`);
  console.log(`  best survival: ${bySurvival.name.padEnd(36)} deaths=${bySurvival.deaths}/${bySurvival.n}`);

  // Save CSV
  const outPath = path.resolve(`scripts/ai/analytical/runs/sweep-${days}D-${Date.now()}.csv`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const csv = [
    'name,mean,p25,p50,p75,p95,max,deaths,n',
    ...allStats.map(s => `${s.name},${s.mean},${s.p25},${s.p50},${s.p75},${s.p95},${s.max},${s.deaths},${s.n}`)
  ].join('\n');
  fs.writeFileSync(outPath, csv);
  console.log(`\nCSV → ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
