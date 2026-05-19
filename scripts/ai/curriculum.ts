// Curriculum runner: starts at short horizons (3 days) where the action space
// is small and learning signal is dense, then progresses to longer tours and
// finally endless mode. At each rung we evaluate the MCTS agent over a seed
// set and submit the best run + a summary entry to the leaderboard.
//
// The MCTS budget (simulations/turn) scales with horizon — short games need
// fewer sims to find good policies; longer games benefit from deeper search.
//
// Submission naming (16-char Supabase cap):
//   AI_MCTS_v<V>          — the top score this run for that days bucket
//   AI_GREEDY_v<V>        — baseline for comparison
//
// Run results are persisted to scripts/ai/runs/<timestamp>.jsonl so successive
// iterations can be compared.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { greedyAgent, mctsAgent, type Agent } from './agents.ts';
import { evalAgent, formatSummary, type EvalSummary } from './eval.ts';
import { submit } from './submit.ts';

const RUNS_DIR = resolve(import.meta.dirname, 'runs');
const VERSION = parseInt(process.env.AI_VERSION ?? '1', 10);

interface Rung {
  days: number;
  mode: 'fixed' | 'endless';
  episodes: number;
  sims: number;        // MCTS simulations per turn
  seedBase: number;
}

// Curriculum: short → long. Sims grow with horizon because longer games have
// more decision points and benefit from deeper search.
// Time budgets observed on a typical laptop:
//   3D  @ 800  sims, 40 eps → ~15s
//   10D @ 1200 sims, 30 eps → ~18 min   (tree depth scales fast)
//   30D @ 1500 sims, 15 eps → ~50 min   (estimate)
//   90D @ 1500 sims, 8 eps  → ~3 hours  (estimate)
// Use --quick to slash counts roughly 4× for fast pipeline validation.
const QUICK = process.argv.includes('--quick');
const CURRICULUM: Rung[] = QUICK ? [
  { days: 3,  mode: 'fixed',   episodes: 10, sims: 400,  seedBase: 1_000 },
  { days: 5,  mode: 'fixed',   episodes: 10, sims: 500,  seedBase: 2_000 },
  { days: 10, mode: 'fixed',   episodes: 8,  sims: 600,  seedBase: 3_000 },
  { days: 15, mode: 'fixed',   episodes: 6,  sims: 700,  seedBase: 4_000 },
  { days: 30, mode: 'fixed',   episodes: 4,  sims: 800,  seedBase: 5_000 },
  { days: 60, mode: 'fixed',   episodes: 3,  sims: 900,  seedBase: 6_000 },
  { days: 90, mode: 'fixed',   episodes: 2,  sims: 1000, seedBase: 7_000 },
  { days: 0,  mode: 'endless', episodes: 2,  sims: 1000, seedBase: 8_000 },
] : [
  { days: 3,  mode: 'fixed',   episodes: 30, sims: 800,  seedBase: 1_000 },
  { days: 5,  mode: 'fixed',   episodes: 25, sims: 900,  seedBase: 2_000 },
  { days: 10, mode: 'fixed',   episodes: 20, sims: 1100, seedBase: 3_000 },
  { days: 15, mode: 'fixed',   episodes: 15, sims: 1200, seedBase: 4_000 },
  { days: 30, mode: 'fixed',   episodes: 10, sims: 1400, seedBase: 5_000 },
  { days: 60, mode: 'fixed',   episodes: 6,  sims: 1600, seedBase: 6_000 },
  { days: 90, mode: 'fixed',   episodes: 4,  sims: 1800, seedBase: 7_000 },
  { days: 0,  mode: 'endless', episodes: 4,  sims: 1600, seedBase: 8_000 },
];

interface RungLog {
  timestamp: string;
  version: number;
  rung: Rung;
  greedy: Omit<EvalSummary, 'results'>;
  mcts: Omit<EvalSummary, 'results'>;
  submitted: { name: string; netWorth: number; days: number; mode: 'fixed' | 'endless' }[];
}

function stripResults(s: EvalSummary): Omit<EvalSummary, 'results'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { results, ...rest } = s;
  return rest;
}

export async function run(): Promise<void> {
  const doSubmit = process.argv.includes('--submit');
  const onlyRung = (() => {
    const i = process.argv.indexOf('--only');
    if (i < 0) return null;
    return parseInt(process.argv[i + 1], 10);
  })();
  const rungs = onlyRung != null ? [CURRICULUM[onlyRung]] : CURRICULUM;

  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = resolve(RUNS_DIR, `curriculum-${stamp}.jsonl`);
  console.log(`[curriculum] version=${VERSION} submit=${doSubmit} log=${logPath}`);
  console.log('');

  for (const rung of rungs) {
    const seeds = Array.from({ length: rung.episodes }, (_, i) => rung.seedBase + i);
    const tag = rung.mode === 'endless' ? '∞' : `${rung.days}D`;

    console.log(`──── Rung ${tag} ──── (${rung.episodes} eps, ${rung.sims} sims/turn)`);

    // Baseline
    const greedy: Agent = greedyAgent();
    const t0 = performance.now();
    const greedySum = evalAgent(greedy, {
      days: rung.days, mode: rung.mode, seeds,
    });
    console.log('  ' + formatSummary(greedySum)
      + `  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);

    // MCTS
    const mcts: Agent = mctsAgent({ simulations: rung.sims });
    const t1 = performance.now();
    const mctsSum = evalAgent(mcts, {
      days: rung.days, mode: rung.mode, seeds,
    });
    console.log('  ' + formatSummary(mctsSum)
      + `  (${((performance.now() - t1) / 1000).toFixed(1)}s)`);

    // Submit
    const submitted: RungLog['submitted'] = [];
    if (doSubmit) {
      // For fixed-mode rungs, days is the tour bucket. For endless, days is the
      // number of days survived in that run.
      // Submit MCTS best and greedy best so the leaderboard reflects both.
      const submitDays = (r: typeof mctsSum.results[number]) =>
        rung.mode === 'endless' ? r.days : rung.days;
      const bestMcts = mctsSum.results.reduce((a, b) => b.netWorth > a.netWorth ? b : a);
      const bestGreedy = greedySum.results.reduce((a, b) => b.netWorth > a.netWorth ? b : a);

      const mctsName = `AI_MCTS_v${VERSION}`.slice(0, 16);
      const greedyName = `AI_GREEDY_v${VERSION}`.slice(0, 16);

      const okM = await submit(mctsName, bestMcts.netWorth, submitDays(bestMcts), rung.mode);
      if (okM) submitted.push({ name: mctsName, netWorth: bestMcts.netWorth, days: submitDays(bestMcts), mode: rung.mode });
      const okG = await submit(greedyName, bestGreedy.netWorth, submitDays(bestGreedy), rung.mode);
      if (okG) submitted.push({ name: greedyName, netWorth: bestGreedy.netWorth, days: submitDays(bestGreedy), mode: rung.mode });
    }

    const entry: RungLog = {
      timestamp: new Date().toISOString(),
      version: VERSION,
      rung,
      greedy: stripResults(greedySum),
      mcts: stripResults(mctsSum),
      submitted,
    };
    writeFileSync(logPath, JSON.stringify(entry) + '\n', { flag: 'a' });
    console.log('');
  }

  console.log(`[curriculum] done → ${logPath}`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  run();
}
