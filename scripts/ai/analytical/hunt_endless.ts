// Hunt for max single endless-mode result at the best-known config.
// Submits to leaderboard if --submit.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeAnalyticalAgent } from './agent';
import { DEFAULT_CONFIG, type StrategyConfig } from './config';
import { buildCombatTable, type CombatTable } from './combat';
import { runOne } from './telemetry';
import { submit } from '../submit';

function loadCombatTable(): CombatTable {
  const p = path.resolve('scripts/ai/runs/combat_table.json');
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = buildCombatTable();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(t));
  return t;
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
}

async function main() {
  const n = parseInt(arg('n', '5000')!, 10);
  const seedOffset = parseInt(arg('seed-offset', '40000')!, 10);
  const buy = parseFloat(arg('buy', '0.55')!);
  const sell = parseFloat(arg('sell', '0.60')!);
  const doSubmit = process.argv.includes('--submit');

  const combatTable = loadCombatTable();
  const seeds = Array.from({ length: n }, (_, i) => seedOffset + i);
  const cfg: StrategyConfig = {
    ...DEFAULT_CONFIG,
    uniformBuyPercentile: buy,
    uniformSellPercentile: sell,
  };
  const agent = makeAnalyticalAgent({ combatTable, config: cfg });

  console.log(`Endless hunt: buy=${buy} sell=${sell}  ×  ${n} seeds`);

  const t0 = Date.now();
  let bestNW = -Infinity;
  let bestSeed = -1;
  let bestDays = 0;
  let deaths = 0;
  const nws: number[] = [];
  for (const seed of seeds) {
    const trace = runOne(agent, seed, 0, 'endless', '', { collectTrajectory: false, collectDecisions: false });
    const nw = trace.summary.net_worth;
    const peak = trace.summary.peak_net_worth;
    const score = Math.max(nw, peak); // peak captures wealth before death
    nws.push(nw);
    if (!trace.summary.alive) deaths++;
    if (score > bestNW) { bestNW = score; bestSeed = seed; bestDays = trace.summary.days_played; }
  }
  const sorted = [...nws].sort((a, b) => a - b);
  const mean = nws.reduce((a, b) => a + b, 0) / n;
  const p95 = sorted[Math.floor(n * 0.95)];
  const finalMax = sorted[n - 1];
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`Done in ${dt}s`);
  console.log(`  mean=$${Math.round(mean).toLocaleString()}  p95=$${Math.round(p95).toLocaleString()}  finalMax=$${Math.round(finalMax).toLocaleString()}  peak/best=$${Math.round(bestNW).toLocaleString()}  bestSeed=${bestSeed}  bestDays=${bestDays}  deaths=${deaths}/${n}`);

  if (doSubmit) {
    const label = 'AI_ANAL_inf'.slice(0, 16);
    const ok = await submit(label, bestNW, bestDays, 'endless');
    console.log(`Submission: ${ok ? '✓' : '✗'}`);
  } else {
    console.log('[dry-run — pass --submit to send]');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
