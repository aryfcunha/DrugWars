// Evaluation harness: run an agent across N seeds at a given tour length.
// Prints summary stats (mean/median/p95/min/max final net worth) so you can
// compare agents reliably across the same seed set.

import { startGame, isTerminal, type FullState } from './sim.ts';
import { netWorth } from '../../src/game/state.ts';
import { type Agent } from './agents.ts';
import { apply, type Macro } from './actions.ts';
import { step as simStep } from './sim.ts';

export interface RunResult {
  seed: number;
  netWorth: number;
  days: number;
  alive: boolean;
  log: string[];   // optional trace
}

export interface EvalSummary {
  agent: string;
  days: number;
  mode: 'fixed' | 'endless';
  n: number;
  mean: number;
  median: number;
  p95: number;
  min: number;
  max: number;
  deathRate: number;
  results: RunResult[];
}

function playOne(
  agent: Agent,
  seed: number,
  totalDays: number,
  mode: 'fixed' | 'endless',
  maxTurns: number,
): RunResult {
  let s: FullState = startGame(seed, totalDays, mode);
  let turns = 0;
  while (!isTerminal(s) && turns < maxTurns) {
    const macro: Macro | null = agent.choose(s);
    if (!macro) break;
    const acts = apply(s, macro);
    if (!acts.length) {
      // Action was a no-op; pick legal[0] to make progress (shouldn't happen with
      // well-formed agents but is a defensive guard against infinite loops)
      turns++;
      continue;
    }
    for (const a of acts) s = simStep(s, a);
    turns++;
  }
  return {
    seed,
    netWorth: netWorth(s),
    days: s.day,
    alive: s.hp > 0,
    log: [],
  };
}

export function evalAgent(
  agent: Agent,
  opts: {
    days: number;
    mode?: 'fixed' | 'endless';
    seeds: number[];
    maxTurns?: number;     // safety cap on turns per game
  },
): EvalSummary {
  const mode = opts.mode ?? 'fixed';
  const maxTurns = opts.maxTurns ?? Math.max(200, opts.days * 6);
  const results: RunResult[] = [];
  for (const seed of opts.seeds) {
    results.push(playOne(agent, seed, opts.days, mode, maxTurns));
  }
  const sorted = [...results].map(r => r.netWorth).sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const median = sorted[Math.floor(n / 2)];
  const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
  const deathRate = results.filter(r => !r.alive).length / n;
  return {
    agent: agent.name,
    days: opts.days,
    mode,
    n,
    mean,
    median,
    p95,
    min: sorted[0],
    max: sorted[n - 1],
    deathRate,
    results,
  };
}

export function formatSummary(s: EvalSummary): string {
  const m = (n: number) => `$${Math.round(n).toLocaleString()}`;
  return `${s.agent.padEnd(14)} ${s.days}D mode=${s.mode} n=${s.n}  `
    + `mean=${m(s.mean).padStart(10)} med=${m(s.median).padStart(10)} `
    + `p95=${m(s.p95).padStart(10)} min=${m(s.min).padStart(10)} `
    + `max=${m(s.max).padStart(10)} death=${(s.deathRate * 100).toFixed(0)}%`;
}
