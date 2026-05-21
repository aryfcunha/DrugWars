// Ship the analytical agent to the leaderboard.
// Runs analytical on N seeds at the requested horizon, picks the best result,
// and submits to the Supabase leaderboard.
//
// Usage:
//   npx tsx scripts/ai/analytical/ship.ts                # 30D, n=1000, dry-run
//   npx tsx scripts/ai/analytical/ship.ts --submit       # actually submit
//   npx tsx scripts/ai/analytical/ship.ts --days 30 --n 2000 --submit

import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeAnalyticalAgent } from './agent';
import { DEFAULT_CONFIG, configHash, type StrategyConfig } from './config';
import { buildCombatTable, type CombatTable } from './combat';
import { runOne } from './telemetry';
import { submit } from '../submit';
import { greedyAgent } from '../agents';

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
  const days = parseInt(arg('days', '30')!, 10);
  const n = parseInt(arg('n', '1000')!, 10);
  const mode: 'fixed' | 'endless' = (arg('mode', 'fixed')! as 'fixed' | 'endless');
  const seedOffset = parseInt(arg('seed-offset', '20000')!, 10);
  const doSubmit = process.argv.includes('--submit');
  const labelOverride = arg('name');

  const combatTable = loadCombatTable();
  const seeds = Array.from({ length: n }, (_, i) => seedOffset + i);
  const cfg: StrategyConfig = { ...DEFAULT_CONFIG };
  const agent = makeAnalyticalAgent({ combatTable, config: cfg });

  console.log(`Ship: ANALYTICAL × ${n} seeds × ${days}D (${mode})`);
  console.log(`  config: buy=${cfg.uniformBuyPercentile} sell=${cfg.uniformSellPercentile} jit=${cfg.jitCoats} early=${cfg.earlyCompoundCoats}`);
  console.log(`  configHash: ${configHash(cfg)}`);
  console.log('');

  const t0 = Date.now();
  const results: { seed: number; netWorth: number; alive: boolean; days: number }[] = [];
  for (const seed of seeds) {
    const trace = runOne(agent, seed, days, mode, '', { collectTrajectory: false, collectDecisions: false });
    results.push({
      seed, netWorth: trace.summary.net_worth,
      alive: trace.summary.alive, days: trace.summary.days_played,
    });
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  // Also run greedy for context
  const greedyResults: typeof results = [];
  for (const seed of seeds) {
    const trace = runOne(greedyAgent(), seed, days, mode, '', { collectTrajectory: false, collectDecisions: false });
    greedyResults.push({
      seed, netWorth: trace.summary.net_worth,
      alive: trace.summary.alive, days: trace.summary.days_played,
    });
  }

  function stats(rs: typeof results) {
    const nws = rs.map(r => r.netWorth).sort((a, b) => a - b);
    return {
      mean: nws.reduce((a, b) => a + b, 0) / nws.length,
      median: nws[Math.floor(nws.length / 2)],
      p95: nws[Math.floor(nws.length * 0.95)],
      max: nws[nws.length - 1],
      bestSeed: rs.reduce((a, b) => b.netWorth > a.netWorth ? b : a).seed,
      deaths: rs.filter(r => !r.alive).length,
    };
  }

  const a = stats(results);
  const g = stats(greedyResults);

  console.log(`Done in ${dt}s\n`);
  console.log('Results:');
  console.log(`  ANALYTICAL  mean=$${Math.round(a.mean).toLocaleString()}  med=$${Math.round(a.median).toLocaleString()}  p95=$${Math.round(a.p95).toLocaleString()}  max=$${Math.round(a.max).toLocaleString()}  deaths=${a.deaths}/${n}  bestSeed=${a.bestSeed}`);
  console.log(`  GREEDY      mean=$${Math.round(g.mean).toLocaleString()}  med=$${Math.round(g.median).toLocaleString()}  p95=$${Math.round(g.p95).toLocaleString()}  max=$${Math.round(g.max).toLocaleString()}  deaths=${g.deaths}/${n}  bestSeed=${g.bestSeed}`);
  console.log('');

  if (!doSubmit) {
    console.log('  [dry-run — pass --submit to send to leaderboard]');
    return;
  }

  // Submit: the leaderboard ranks by single-best net worth.
  // We submit both for fairness in the leaderboard's per-name slot.
  const labelAnal = (labelOverride ?? `AI_ANAL_v1`).slice(0, 16);
  const labelGr = `AI_GREEDY_v1`.slice(0, 16);

  const okA = await submit(labelAnal, a.max, days, mode);
  const okG = await submit(labelGr, g.max, days, mode);
  console.log(`\nSubmissions: analytical=${okA ? '✓' : '✗'}  greedy=${okG ? '✓' : '✗'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
