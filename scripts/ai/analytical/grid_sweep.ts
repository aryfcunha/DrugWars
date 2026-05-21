// 10pp grid sweep over (buyPercentile, sellPercentile, jitCoats) at 30D.
// Renders a heatmap-ish table sorted by each objective.

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

interface Cell {
  buy: number;
  sell: number;
  jit: boolean;
  mean: number;
  p50: number;
  p95: number;
  max: number;
  deaths: number;
  n: number;
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

  const BUYS = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40];
  const SELLS = [0.40, 0.45, 0.50, 0.55, 0.60];
  const JITS = [false, true];

  const cells: Cell[] = [];
  let count = 0;
  for (const b of BUYS) for (const s of SELLS) for (const j of JITS) if (s > b) count++;
  console.log(`Grid sweep: ${count} configs × ${n} seeds × ${days}D`);

  const t0 = Date.now();
  let idx = 0;
  for (const buy of BUYS) {
    for (const sell of SELLS) {
      if (sell <= buy) continue;
      for (const jit of JITS) {
        idx++;
        const cfg: StrategyConfig = {
          ...DEFAULT_CONFIG,
          buyMode: 'uniform-percentile',
          sellMode: 'uniform-percentile',
          uniformBuyPercentile: buy,
          uniformSellPercentile: sell,
          jitCoats: jit,
        };
        const agent = makeAnalyticalAgent({ combatTable, config: cfg });
        const nws: number[] = [];
        let deaths = 0;
        for (const seed of seeds) {
          const trace = runOne(agent, seed, days, 'fixed', '', { collectTrajectory: false, collectDecisions: false });
          nws.push(trace.summary.net_worth);
          if (!trace.summary.alive) deaths++;
        }
        const sorted = [...nws].sort((a, b) => a - b);
        const mean = nws.reduce((a, b) => a + b, 0) / nws.length;
        const cell: Cell = {
          buy, sell, jit,
          mean,
          p50: quantile(sorted, 0.50),
          p95: quantile(sorted, 0.95),
          max: sorted[sorted.length - 1],
          deaths,
          n: nws.length,
        };
        cells.push(cell);
        const tag = `${buy.toFixed(2)}/${sell.toFixed(2)} ${jit ? 'JIT' : '   '}`;
        console.log(`  [${idx}/${count}] ${tag}  mean=${money(mean).padStart(10)} p95=${money(cell.p95).padStart(10)} max=${money(cell.max).padStart(10)} deaths=${deaths}`);
      }
    }
  }
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  // ── Render two 5×5 tables: one for no-JIT, one for JIT ──
  function renderTable(metric: keyof Cell, label: string, jit: boolean) {
    console.log(`\n── ${label} (${jit ? 'JIT on' : 'no JIT'}) — rows=buyPercentile, cols=sellPercentile ──`);
    const header = ['  buy\\sell', ...SELLS.map(s => s.toFixed(2).padStart(10))].join(' ');
    console.log(header);
    for (const b of BUYS) {
      const cells_row = SELLS.map(s => {
        if (s <= b) return '       --';
        const c = cells.find(x => x.buy === b && x.sell === s && x.jit === jit);
        if (!c) return '        ?';
        const v = c[metric] as number;
        if (typeof v === 'number') {
          if (metric === 'deaths') return v.toString().padStart(10);
          return money(v).padStart(10);
        }
        return '        ?';
      });
      console.log(`  ${b.toFixed(2)}    ` + cells_row.join(' '));
    }
  }

  for (const jit of JITS) {
    renderTable('mean', 'MEAN', jit);
    renderTable('p95', 'P95', jit);
    renderTable('max', 'MAX', jit);
    renderTable('deaths', 'DEATHS', jit);
  }

  // ── Top 5 by each objective ──
  console.log('\n── Top 5 by each objective ──');
  const sortBy = (k: keyof Cell, desc = true) => [...cells].sort((a, b) => desc ? (b[k] as number) - (a[k] as number) : (a[k] as number) - (b[k] as number));
  const tag = (c: Cell) => `buy=${c.buy.toFixed(2)} sell=${c.sell.toFixed(2)} ${c.jit ? 'JIT' : '   '}`;
  console.log('\nbest mean:');
  for (const c of sortBy('mean').slice(0, 5)) console.log(`  ${tag(c)}  mean=${money(c.mean)} p95=${money(c.p95)} max=${money(c.max)} deaths=${c.deaths}`);
  console.log('\nbest p95:');
  for (const c of sortBy('p95').slice(0, 5)) console.log(`  ${tag(c)}  mean=${money(c.mean)} p95=${money(c.p95)} max=${money(c.max)} deaths=${c.deaths}`);
  console.log('\nbest max (leaderboard):');
  for (const c of sortBy('max').slice(0, 5)) console.log(`  ${tag(c)}  mean=${money(c.mean)} p95=${money(c.p95)} max=${money(c.max)} deaths=${c.deaths}`);
  console.log('\nfewest deaths:');
  for (const c of sortBy('deaths', false).slice(0, 5)) console.log(`  ${tag(c)}  mean=${money(c.mean)} p95=${money(c.p95)} max=${money(c.max)} deaths=${c.deaths}`);

  const outPath = path.resolve(`scripts/ai/analytical/runs/grid-${days}D-${Date.now()}.csv`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const csv = ['buy,sell,jit,mean,p50,p95,max,deaths,n', ...cells.map(c => `${c.buy},${c.sell},${c.jit},${c.mean},${c.p50},${c.p95},${c.max},${c.deaths},${c.n}`)].join('\n');
  fs.writeFileSync(outPath, csv);
  console.log(`\nCSV → ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
