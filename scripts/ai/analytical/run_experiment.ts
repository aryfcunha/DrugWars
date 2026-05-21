// Run an analytical-agent experiment, emit telemetry, build report.
//
// Usage:
//   npx tsx scripts/ai/analytical/run_experiment.ts <name> [--days 30] [--n 500] [--config k=v,k=v]
//
// Examples:
//   npx tsx scripts/ai/analytical/run_experiment.ts baseline-30D
//   npx tsx scripts/ai/analytical/run_experiment.ts no-bank-30D --config bankingMode=off
//   npx tsx scripts/ai/analytical/run_experiment.ts always-run-30D --config combatMode=always-run

import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeAnalyticalAgent } from './agent';
import { DEFAULT_CONFIG, configHash, type StrategyConfig } from './config';
import { buildCombatTable, type CombatTable } from './combat';
import { runExperiment } from './telemetry';
import { buildReport } from './report';

function loadCombatTable(): CombatTable {
  const p = path.resolve('scripts/ai/runs/combat_table.json');
  if (!fs.existsSync(p)) {
    console.log('Combat table missing — building (~15s)...');
    const t = buildCombatTable();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(t));
    return t;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function parseConfigOverrides(spec: string | undefined): Partial<StrategyConfig> {
  const out: Partial<StrategyConfig> = {};
  if (!spec) return out;
  for (const pair of spec.split(',')) {
    const [k, v] = pair.split('=');
    if (!k || v == null) continue;
    const key = k.trim() as keyof StrategyConfig;
    const value = v.trim();
    // Try numeric coercion
    const num = Number(value);
    if (!Number.isNaN(num) && value !== '') (out as Record<string, unknown>)[key] = num;
    else if (value === 'true' || value === 'false') (out as Record<string, unknown>)[key] = value === 'true';
    else (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      flags[key] = next && !next.startsWith('--') ? (i++, next) : 'true';
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const name = positional[0];
  if (!name) {
    console.error('Usage: run_experiment.ts <name> [--days 30] [--n 500] [--config k=v,k=v] [--seed-offset 0]');
    process.exit(1);
  }
  const days = parseInt(flags.days ?? '30', 10);
  const n = parseInt(flags.n ?? '500', 10);
  const seedOffset = parseInt(flags['seed-offset'] ?? '1000', 10);
  const overrides = parseConfigOverrides(flags.config);
  const cfg: StrategyConfig = { ...DEFAULT_CONFIG, ...overrides };

  const combatTable = loadCombatTable();
  const agent = makeAnalyticalAgent({ combatTable, config: cfg });

  const expId = `${name}-${days}D-${configHash(cfg)}`;
  const seeds = Array.from({ length: n }, (_, i) => seedOffset + i);

  console.log(`Experiment: ${expId}`);
  console.log(`  agent:   ${agent.name}`);
  console.log(`  config:  ${JSON.stringify(cfg)}`);
  console.log(`  horizon: ${days}D, n=${n}`);
  const start = Date.now();
  const result = runExperiment({
    experimentId: expId,
    agent,
    configHash: configHash(cfg),
    seeds,
    horizon: days,
  });
  console.log(`Done in ${(result.elapsedMs / 1000).toFixed(1)}s (total ${(Date.now() - start) / 1000}s)`);

  // Quick stats
  const nws = result.summaries.map(s => s.net_worth).sort((a, b) => a - b);
  const mean = nws.reduce((a, b) => a + b, 0) / nws.length;
  const median = nws[Math.floor(nws.length / 2)];
  const p95 = nws[Math.floor(nws.length * 0.95)];
  const deaths = result.summaries.filter(s => !s.alive).length;
  console.log(`  mean=$${Math.round(mean).toLocaleString()} med=$${Math.round(median).toLocaleString()} p95=$${Math.round(p95).toLocaleString()} death=${deaths}/${n}`);

  // Build full report
  const md = buildReport(result.outDir);
  fs.writeFileSync(path.join(result.outDir, 'report.md'), md);
  console.log(`Report: ${path.join(result.outDir, 'report.md')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
