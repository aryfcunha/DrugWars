// Sweep buy/sell percentiles on endless mode to find max-optimizing config.
//
// Endless leaderboard scores by max single run. Wider sell percentiles (hold
// longer for bigger windows) may dominate the tighter 30D-optimal config.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeAnalyticalAgent } from './agent';
import { DEFAULT_CONFIG, type StrategyConfig } from './config';
import { buildCombatTable, type CombatTable } from './combat';
import { runOne } from './telemetry';

function loadCombatTable(): CombatTable {
  const p = path.resolve('scripts/ai/runs/combat_table.json');
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = buildCombatTable();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(t));
  return t;
}

function money(n: number): string {
  const s = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}k`;
  return `${s}$${Math.round(a)}`;
}

async function main() {
  const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
  const n = parseInt(arg('n', '1000')!, 10);
  const seedOffset = parseInt(arg('seed-offset', '40000')!, 10);
  const combatTable = loadCombatTable();
  const seeds = Array.from({ length: n }, (_, i) => seedOffset + i);

  const BUYS = [0.20, 0.30, 0.40, 0.55];
  const SELLS = [0.50, 0.60, 0.70, 0.80];

  console.log(`Endless sweep: ${BUYS.length * SELLS.length} configs × ${n} seeds\n`);
  const results: { buy: number; sell: number; mean: number; p95: number; max: number; deaths: number }[] = [];

  for (const buy of BUYS) {
    for (const sell of SELLS) {
      if (sell <= buy) continue;
      const cfg: StrategyConfig = {
        ...DEFAULT_CONFIG,
        uniformBuyPercentile: buy,
        uniformSellPercentile: sell,
      };
      const agent = makeAnalyticalAgent({ combatTable, config: cfg });
      const nws: number[] = [];
      let deaths = 0;
      for (const seed of seeds) {
        const trace = runOne(agent, seed, 0, 'endless', '', { collectTrajectory: false, collectDecisions: false });
        nws.push(trace.summary.net_worth);
        if (!trace.summary.alive) deaths++;
      }
      const sorted = [...nws].sort((a, b) => a - b);
      const mean = nws.reduce((a, b) => a + b, 0) / nws.length;
      const p95 = sorted[Math.floor(nws.length * 0.95)];
      const max = sorted[nws.length - 1];
      results.push({ buy, sell, mean, p95, max, deaths });
      console.log(`  buy=${buy.toFixed(2)} sell=${sell.toFixed(2)}  mean=${money(mean).padStart(10)} p95=${money(p95).padStart(10)} max=${money(max).padStart(10)} deaths=${deaths}`);
    }
  }

  console.log('\n── Best by max (leaderboard) ──');
  results.sort((a, b) => b.max - a.max);
  for (const r of results.slice(0, 5)) {
    console.log(`  buy=${r.buy.toFixed(2)} sell=${r.sell.toFixed(2)}  max=${money(r.max)}  mean=${money(r.mean)}  deaths=${r.deaths}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
