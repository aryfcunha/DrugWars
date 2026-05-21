// 3D sweep: (buyPct, sellPct, coatMode) at 30D.
// coatMode = jit-only | jit+early | jit+aggressive | aggressive-only

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

interface CoatMode {
  label: string;
  jit: boolean;
  early: boolean;
  aggressive: boolean;
}

interface Cell {
  buy: number;
  sell: number;
  coat: string;
  mean: number;
  p50: number;
  p95: number;
  max: number;
  deaths: number;
  n: number;
  meanCoatSpend: number;
  meanFinalCapacity: number;
}

function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}

function money(n: number): string {
  const s = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}k`;
  return `${s}$${Math.round(a)}`;
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

  const BUYS = [0.15, 0.20, 0.25];
  const SELLS = [0.40, 0.45, 0.50];
  const COATS: CoatMode[] = [
    { label: 'jit-only',        jit: true,  early: false, aggressive: false },
    { label: 'jit+early',       jit: true,  early: true,  aggressive: false },
    { label: 'jit+aggressive',  jit: true,  early: false, aggressive: true  },
    { label: 'aggressive-only', jit: false, early: false, aggressive: true  },
  ];

  const cells: Cell[] = [];
  let count = 0;
  for (const b of BUYS) for (const s of SELLS) for (const _c of COATS) if (s > b) count++;
  console.log(`Coat sweep: ${count} configs × ${n} seeds × ${days}D\n`);

  const t0 = Date.now();
  let idx = 0;
  for (const buy of BUYS) {
    for (const sell of SELLS) {
      if (sell <= buy) continue;
      for (const cm of COATS) {
        idx++;
        const cfg: StrategyConfig = {
          ...DEFAULT_CONFIG,
          buyMode: 'uniform-percentile',
          sellMode: 'uniform-percentile',
          uniformBuyPercentile: buy,
          uniformSellPercentile: sell,
          jitCoats: cm.jit,
          earlyCompoundCoats: cm.early,
          aggressiveCoats: cm.aggressive,
        };
        const agent = makeAnalyticalAgent({ combatTable, config: cfg });
        const nws: number[] = [];
        const caps: number[] = [];
        const coatSpends: number[] = [];
        let deaths = 0;
        for (const seed of seeds) {
          const trace = runOne(agent, seed, days, 'fixed', '', { collectTrajectory: false, collectDecisions: false });
          nws.push(trace.summary.net_worth);
          caps.push(trace.summary.final_capacity);
          coatSpends.push(trace.summary.total_coat_spend);
          if (!trace.summary.alive) deaths++;
        }
        const sorted = [...nws].sort((a, b) => a - b);
        const mean = nws.reduce((a, b) => a + b, 0) / nws.length;
        const meanCoat = coatSpends.reduce((a, b) => a + b, 0) / coatSpends.length;
        const meanCap = caps.reduce((a, b) => a + b, 0) / caps.length;
        const cell: Cell = {
          buy, sell, coat: cm.label,
          mean,
          p50: quantile(sorted, 0.50),
          p95: quantile(sorted, 0.95),
          max: sorted[sorted.length - 1],
          deaths,
          n: nws.length,
          meanCoatSpend: meanCoat,
          meanFinalCapacity: meanCap,
        };
        cells.push(cell);
        console.log(`  [${idx}/${count}] buy=${buy.toFixed(2)} sell=${sell.toFixed(2)} ${cm.label.padEnd(16)} mean=${money(mean).padStart(10)} p95=${money(cell.p95).padStart(10)} max=${money(cell.max).padStart(10)} cap=${Math.round(meanCap).toString().padStart(5)} coat$=${money(meanCoat).padStart(6)} dead=${deaths}`);
      }
    }
  }
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  // Top by each objective
  console.log('── Best by objective ──\n');
  const sortBy = (k: keyof Cell, desc = true) => [...cells].sort((a, b) => desc ? (b[k] as number) - (a[k] as number) : (a[k] as number) - (b[k] as number));
  const tag = (c: Cell) => `buy=${c.buy.toFixed(2)} sell=${c.sell.toFixed(2)} ${c.coat.padEnd(16)}`;
  console.log('best mean:');
  for (const c of sortBy('mean').slice(0, 5)) console.log(`  ${tag(c)}  mean=${money(c.mean)}  p95=${money(c.p95)}  max=${money(c.max)}  cap=${Math.round(c.meanFinalCapacity)}  dead=${c.deaths}`);
  console.log('\nbest p95:');
  for (const c of sortBy('p95').slice(0, 5)) console.log(`  ${tag(c)}  mean=${money(c.mean)}  p95=${money(c.p95)}  max=${money(c.max)}  cap=${Math.round(c.meanFinalCapacity)}  dead=${c.deaths}`);
  console.log('\nbest max (leaderboard):');
  for (const c of sortBy('max').slice(0, 5)) console.log(`  ${tag(c)}  mean=${money(c.mean)}  p95=${money(c.p95)}  max=${money(c.max)}  cap=${Math.round(c.meanFinalCapacity)}  dead=${c.deaths}`);
  console.log('\nfewest deaths:');
  for (const c of sortBy('deaths', false).slice(0, 5)) console.log(`  ${tag(c)}  mean=${money(c.mean)}  p95=${money(c.p95)}  max=${money(c.max)}  cap=${Math.round(c.meanFinalCapacity)}  dead=${c.deaths}`);

  const outPath = path.resolve(`scripts/ai/analytical/runs/coat-sweep-${days}D-${Date.now()}.csv`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const csv = ['buy,sell,coat,mean,p50,p95,max,deaths,meanCoatSpend,meanFinalCapacity,n',
    ...cells.map(c => `${c.buy},${c.sell},${c.coat},${c.mean},${c.p50},${c.p95},${c.max},${c.deaths},${c.meanCoatSpend},${c.meanFinalCapacity},${c.n}`)
  ].join('\n');
  fs.writeFileSync(outPath, csv);
  console.log(`\nCSV → ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
