// Replay a single seed with full telemetry and print a readable trace.
// Usage: npx tsx scripts/ai/analytical/inspect_seed.ts --seed 40838 --mode endless [--buy 0.55 --sell 0.60]

import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeAnalyticalAgent } from './agent';
import { DEFAULT_CONFIG, type StrategyConfig } from './config';
import { buildCombatTable, type CombatTable } from './combat';
import { runOne } from './telemetry';

function loadCombatTable(): CombatTable {
  const p = path.resolve('scripts/ai/runs/combat_table.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
}

function money(n: number): string {
  const s = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}k`;
  return `${s}$${Math.round(a)}`;
}

async function main() {
  const seed = parseInt(arg('seed', '40838')!, 10);
  const mode = (arg('mode', 'endless')! as 'fixed' | 'endless');
  const days = parseInt(arg('days', '0')!, 10);
  const buy = parseFloat(arg('buy', '0.55')!);
  const sell = parseFloat(arg('sell', '0.60')!);

  const combatTable = loadCombatTable();
  const cfg: StrategyConfig = {
    ...DEFAULT_CONFIG,
    uniformBuyPercentile: buy,
    uniformSellPercentile: sell,
  };
  const agent = makeAnalyticalAgent({ combatTable, config: cfg });

  const trace = runOne(agent, seed, days, mode, '', { collectTrajectory: true, collectDecisions: true, trajectoryStride: 1 });

  console.log(`Seed ${seed}  ${mode}  buy=${buy} sell=${sell}`);
  console.log(`  alive=${trace.summary.alive}  days_played=${trace.summary.days_played}  cause=${trace.summary.cause_of_death}`);
  console.log(`  final NW=${money(trace.summary.net_worth)}  peak NW=${money(trace.summary.peak_net_worth)} (day ${trace.summary.peak_day})`);
  console.log(`  final cash=${money(trace.summary.final_cash)}  bank=${money(trace.summary.final_bank)}  debt=${money(trace.summary.final_debt)}`);
  console.log(`  final capacity=${trace.summary.final_capacity}  guns=${trace.summary.final_guns}`);
  console.log(`  turns=${trace.summary.turn_count}`);
  console.log(`  total buys=${trace.summary.total_buys}  sells=${trace.summary.total_sells}`);
  console.log(`  spent on drugs=${money(trace.summary.total_spent_drugs)}  revenue=${money(trace.summary.total_revenue_drugs)}`);
  console.log(`  coat spend=${money(trace.summary.total_coat_spend)}  debt paid=${money(trace.summary.total_debt_paid)}`);
  console.log(`  cop encounters=${trace.summary.cop_encounters}  fights=${trace.summary.fights_chosen}  runs=${trace.summary.runs_chosen}  hp lost=${trace.summary.hp_lost_total}  drugs dropped=${trace.summary.drug_units_dropped}`);
  console.log(`  events: ${JSON.stringify(trace.summary.events_by_kind)}`);
  console.log(`  action mix: ${JSON.stringify(trace.summary.count_by_macro)}`);
  console.log('');

  // Day-by-day net worth ride
  console.log('Day-by-day (one row per day = end-of-day state):');
  const byDay = new Map<number, typeof trace.trajectory[number]>();
  for (const t of trace.trajectory) byDay.set(t.day, t);
  const sortedDays = [...byDay.keys()].sort((a, b) => a - b);
  console.log('  day  loc       cash       bank       debt       inv       NW         cap   inv_used   hp guns macro');
  for (const d of sortedDays) {
    const t = byDay.get(d)!;
    console.log(`  ${String(d).padStart(3)}  ${(t.loc).padEnd(9)} ${money(t.cash).padStart(10)} ${money(t.bank).padStart(10)} ${money(t.debt).padStart(10)} ${money(t.inv_value).padStart(10)} ${money(t.net_worth).padStart(10)} ${String(t.capacity).padStart(5)} ${String(t.inv_used).padStart(8)} ${String(t.hp).padStart(4)} ${String(t.guns).padStart(4)} ${t.macro}`);
  }

  // Decision log (combat + offers only)
  if (trace.decisions.length > 0) {
    console.log('\nDecision points (combat + offers):');
    for (const d of trace.decisions) {
      console.log(`  day ${d.day}  ${d.phase}  → ${d.chosen}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
