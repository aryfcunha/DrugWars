// Run analytical agent on endless mode.
// Endless mode has no fixed end; the sim caps at maxTurns. Cop risk ramps after day 30.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeAnalyticalAgent } from './agent';
import { DEFAULT_CONFIG, type StrategyConfig } from './config';
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
  const n = parseInt(arg('n', '500')!, 10);
  const seedOffset = parseInt(arg('seed-offset', '40000')!, 10);
  const doSubmit = process.argv.includes('--submit');
  const labelOverride = arg('name');

  const combatTable = loadCombatTable();
  const seeds = Array.from({ length: n }, (_, i) => seedOffset + i);
  const cfg: StrategyConfig = { ...DEFAULT_CONFIG };
  const agent = makeAnalyticalAgent({ combatTable, config: cfg });

  console.log(`Endless: ANALYTICAL × ${n} seeds`);
  console.log(`  config: buy=${cfg.uniformBuyPercentile} sell=${cfg.uniformSellPercentile} jit=${cfg.jitCoats} early=${cfg.earlyCompoundCoats}\n`);

  const t0 = Date.now();
  const results: { seed: number; netWorth: number; alive: boolean; days: number; peakNW: number; finalCap: number }[] = [];
  for (const seed of seeds) {
    const trace = runOne(agent, seed, 0, 'endless', '', { collectTrajectory: false, collectDecisions: false });
    results.push({
      seed, netWorth: trace.summary.net_worth,
      alive: trace.summary.alive, days: trace.summary.days_played,
      peakNW: trace.summary.peak_net_worth,
      finalCap: trace.summary.final_capacity,
    });
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  // Also run greedy for context
  const gResults: typeof results = [];
  for (const seed of seeds) {
    const trace = runOne(greedyAgent(), seed, 0, 'endless', '', { collectTrajectory: false, collectDecisions: false });
    gResults.push({
      seed, netWorth: trace.summary.net_worth,
      alive: trace.summary.alive, days: trace.summary.days_played,
      peakNW: trace.summary.peak_net_worth,
      finalCap: trace.summary.final_capacity,
    });
  }

  function stats(rs: typeof results) {
    const nws = rs.map(r => r.netWorth).sort((a, b) => a - b);
    const peaks = rs.map(r => r.peakNW).sort((a, b) => a - b);
    const caps = rs.map(r => r.finalCap).sort((a, b) => a - b);
    const days = rs.map(r => r.days).sort((a, b) => a - b);
    return {
      mean: nws.reduce((a, b) => a + b, 0) / nws.length,
      median: nws[Math.floor(nws.length / 2)],
      p95: nws[Math.floor(nws.length * 0.95)],
      max: nws[nws.length - 1],
      peakMax: peaks[peaks.length - 1],
      bestSeed: rs.reduce((a, b) => b.netWorth > a.netWorth ? b : a).seed,
      bestPeakSeed: rs.reduce((a, b) => b.peakNW > a.peakNW ? b : a).seed,
      deaths: rs.filter(r => !r.alive).length,
      meanDays: days.reduce((a, b) => a + b, 0) / days.length,
      maxCap: caps[caps.length - 1],
    };
  }

  const a = stats(results);
  const g = stats(gResults);
  const money = (n: number) => n.toLocaleString();

  console.log(`Done in ${dt}s\n`);
  console.log('Results:');
  console.log(`  ANALYTICAL  mean=$${money(Math.round(a.mean))}  med=$${money(Math.round(a.median))}  p95=$${money(Math.round(a.p95))}  max=$${money(Math.round(a.max))}  peakMax=$${money(Math.round(a.peakMax))}  meanDays=${a.meanDays.toFixed(1)}  maxCap=${a.maxCap}  deaths=${a.deaths}/${n}  bestSeed=${a.bestSeed}`);
  console.log(`  GREEDY      mean=$${money(Math.round(g.mean))}  med=$${money(Math.round(g.median))}  p95=$${money(Math.round(g.p95))}  max=$${money(Math.round(g.max))}  peakMax=$${money(Math.round(g.peakMax))}  meanDays=${g.meanDays.toFixed(1)}  maxCap=${g.maxCap}  deaths=${g.deaths}/${n}  bestSeed=${g.bestSeed}\n`);

  if (doSubmit) {
    const labelAnal = (labelOverride ?? 'AI_ANAL_inf').slice(0, 16);
    const okA = await submit(labelAnal, a.max, results.find(r => r.seed === a.bestSeed)!.days, 'endless');
    console.log(`\nSubmission: analytical=${okA ? '✓' : '✗'}`);
  } else {
    console.log('[dry-run — pass --submit to send]');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
