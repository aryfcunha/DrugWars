// CLI entry: `tsx scripts/ai/cli.ts <command> [opts]`
//
// Commands:
//   eval    — benchmark agents over a fixed seed set
//   train   — curriculum (3D → 90D + endless), submits to leaderboard
//   submit  — manually submit a single result by replaying a seed
//
// Examples:
//   tsx scripts/ai/cli.ts eval --days 3 --n 50
//   tsx scripts/ai/cli.ts eval --days 30 --n 30 --agent mcts --sims 2000
//   tsx scripts/ai/cli.ts train --rungs 3,5,10,15,30 --episodes 40 --submit

import { randomAgent, greedyAgent, mctsAgent, type Agent } from './agents.ts';
import { evalAgent, formatSummary } from './eval.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  return process.argv[i + 1];
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function makeAgent(kind: string, opts: { sims?: number; seed?: number }): Agent {
  switch (kind) {
    case 'random':  return randomAgent(opts.seed ?? 0xC0FFEE);
    case 'greedy':  return greedyAgent();
    case 'mcts':    return mctsAgent({ simulations: opts.sims ?? 1500 });
    default: throw new Error(`unknown agent: ${kind}`);
  }
}

async function cmdEval() {
  const days = parseInt(arg('days', '30')!, 10);
  const n = parseInt(arg('n', '20')!, 10);
  const seedBase = parseInt(arg('seed', '1')!, 10);
  const sims = parseInt(arg('sims', '1500')!, 10);
  const which = (arg('agent') ?? 'all').toLowerCase();
  const mode = (arg('mode', 'fixed') as 'fixed' | 'endless');

  const seeds = Array.from({ length: n }, (_, i) => seedBase + i);
  const agents: Agent[] = which === 'all'
    ? [randomAgent(seedBase), greedyAgent(), mctsAgent({ simulations: sims })]
    : [makeAgent(which, { sims, seed: seedBase })];

  console.log(`days=${days} mode=${mode} n=${n} seeds=${seeds[0]}..${seeds.at(-1)}`);
  for (const a of agents) {
    const t0 = performance.now();
    const summary = evalAgent(a, { days, mode, seeds });
    const dt = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(formatSummary(summary) + `   (${dt}s)`);
  }
}

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'eval':   return cmdEval();
    case 'train':  return import('./curriculum.ts').then(m => m.run());
    default:
      console.error(`usage: tsx scripts/ai/cli.ts {eval|train} [--days N] [--n N] [--agent random|greedy|mcts|all] [--sims N] [--mode fixed|endless]`);
      process.exit(1);
  }
}

main();
