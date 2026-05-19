// AlphaZero outer loop: alternating self-play data collection and SGD training.
//
//   For iteration = 1..K:
//     1. Self-play: play N games with current net (MCTS+priors+value+Dirichlet noise),
//        record (state_features, π_visit, legal_mask, final_return) at every turn.
//     2. Train: K_epochs over the buffer, mini-batch SGD via Adam.
//     3. Eval: benchmark against greedy + MCTS-rollouts baselines on a fixed seed set.
//     4. Save the network and log results.
//
// Usage:
//   tsx scripts/ai/iterate.ts --days 5 --iters 6 --games 30 --sims 80 [--save path.json] [--load path.json]

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { startGame, isTerminal, type FullState } from './sim.ts';
import { netWorth } from '../../src/game/state.ts';
import { type Macro, apply } from './actions.ts';
import { step as simStep } from './sim.ts';
import { makeNet, trainStep, saveNet, loadNet, type Net, type Batch } from './nn.ts';
import { featurize } from './features.ts';
import { azAgent, azSelfplayMove, DEFAULT_AZ } from './agent_az.ts';
import { greedyAgent, mctsAgent } from './agents.ts';
import { evalAgent, formatSummary } from './eval.ts';

interface SelfPlaySample {
  x: Float32Array;
  pi: Float32Array;
  mask: Float32Array;
  finalValue?: number;  // filled at episode end
}

function valueOf(s: FullState): number {
  return Math.tanh(netWorth(s) / 30_000);
}

/** Play one self-play episode and return the trajectory of (x, π, mask, v_target). */
function selfplayEpisode(
  net: Net,
  seed: number,
  days: number,
  mode: 'fixed' | 'endless',
  sims: number,
  dirichletEps: number,
  earlyTemp: number,         // visits temperature for first K moves
  earlyTempMoves: number,
): SelfPlaySample[] {
  let s: FullState = startGame(seed, days, mode);
  const traj: SelfPlaySample[] = [];
  const maxTurns = Math.max(200, days * 6);
  let turn = 0;
  while (!isTerminal(s) && turn < maxTurns) {
    const T = turn < earlyTempMoves ? earlyTemp : 0;
    const move = azSelfplayMove(net, s, {
      ...DEFAULT_AZ,
      simulations: sims,
      dirichletEps,
      temperature: T,
    });
    if (!move) break;
    traj.push({ x: featurize(s), pi: move.pi, mask: move.mask });
    const acts = apply(s, move.macro);
    for (const a of acts) s = simStep(s, a);
    turn++;
  }
  const vFinal = valueOf(s);
  for (const sample of traj) sample.finalValue = vFinal;
  return traj;
}

function shuffleInplace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

interface IterCfg {
  days: number;
  mode: 'fixed' | 'endless';
  iters: number;
  gamesPerIter: number;
  simsPerMove: number;
  epochs: number;
  batchSize: number;
  evalEvery: number;          // eval every K iterations
  evalSeeds: number[];
  evalSims: number;           // sims for eval-time AZ agent
  lr?: number;
  loadFrom?: string;
  saveTo?: string;
  logPath?: string;
}

export async function iterate(cfg: IterCfg): Promise<{ net: Net; results: any[] }> {
  const net: Net = cfg.loadFrom ? loadNet(cfg.loadFrom) : makeNet(64);
  const results: any[] = [];
  const buf: SelfPlaySample[] = [];
  const BUF_MAX = 20_000;

  console.log(`[iterate] days=${cfg.days} mode=${cfg.mode} iters=${cfg.iters} games/iter=${cfg.gamesPerIter} sims/move=${cfg.simsPerMove}`);

  for (let it = 1; it <= cfg.iters; it++) {
    const t0 = performance.now();

    // Self-play
    let added = 0;
    for (let g = 0; g < cfg.gamesPerIter; g++) {
      const seed = 10_000 + it * 1000 + g;
      const traj = selfplayEpisode(
        net, seed, cfg.days, cfg.mode, cfg.simsPerMove,
        /* dirichletEps */ 0.25,
        /* earlyTemp */    1.0,
        /* earlyTempMoves*/ 3,
      );
      buf.push(...traj);
      added += traj.length;
    }
    if (buf.length > BUF_MAX) buf.splice(0, buf.length - BUF_MAX);
    const tSP = ((performance.now() - t0) / 1000).toFixed(1);

    // Train
    const t1 = performance.now();
    const dataset = buf.slice();
    shuffleInplace(dataset);
    let polLoss = 0, valLoss = 0, steps = 0;
    for (let ep = 0; ep < cfg.epochs; ep++) {
      for (let i = 0; i < dataset.length; i += cfg.batchSize) {
        const slice = dataset.slice(i, i + cfg.batchSize);
        const batch: Batch = {
          x: slice.map(s => s.x),
          piTarget: slice.map(s => s.pi),
          mask: slice.map(s => s.mask),
          vTarget: slice.map(s => s.finalValue!),
        };
        const loss = trainStep(net, batch);
        polLoss += loss.policyLoss;
        valLoss += loss.valueLoss;
        steps++;
      }
    }
    const tTr = ((performance.now() - t1) / 1000).toFixed(1);

    const meanPol = steps ? polLoss / steps : 0;
    const meanVal = steps ? valLoss / steps : 0;
    console.log(`  iter ${it}/${cfg.iters}  buf=${buf.length}  +${added} samples  `
      + `polL=${meanPol.toFixed(3)}  valL=${meanVal.toFixed(4)}  `
      + `sp=${tSP}s  tr=${tTr}s`);

    // Eval
    if (it % cfg.evalEvery === 0 || it === cfg.iters) {
      const t2 = performance.now();
      const az = azAgent(net, { simulations: cfg.evalSims, dirichletEps: 0, temperature: 0 });
      const sum = evalAgent(az, { days: cfg.days, mode: cfg.mode, seeds: cfg.evalSeeds });
      console.log('    ' + formatSummary(sum) + `  (${((performance.now() - t2)/1000).toFixed(1)}s)`);
      results.push({ iter: it, polLoss: meanPol, valLoss: meanVal, eval: { mean: sum.mean, median: sum.median, max: sum.max, deathRate: sum.deathRate } });
      if (cfg.logPath) writeFileSync(cfg.logPath, JSON.stringify(results, null, 2));
    }

    if (cfg.saveTo) saveNet(net, cfg.saveTo);
  }

  // Final baselines for context
  console.log('  baselines:');
  const greedy = evalAgent(greedyAgent(), { days: cfg.days, mode: cfg.mode, seeds: cfg.evalSeeds });
  const mcts = evalAgent(mctsAgent({ simulations: cfg.evalSims * 3 }), { days: cfg.days, mode: cfg.mode, seeds: cfg.evalSeeds });
  console.log('    ' + formatSummary(greedy));
  console.log('    ' + formatSummary(mcts));

  return { net, results };
}

// CLI entry
function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
}

async function main() {
  const days = parseInt(arg('days', '5')!, 10);
  const iters = parseInt(arg('iters', '4')!, 10);
  const games = parseInt(arg('games', '20')!, 10);
  const sims = parseInt(arg('sims', '80')!, 10);
  const epochs = parseInt(arg('epochs', '3')!, 10);
  const batchSize = parseInt(arg('batch', '32')!, 10);
  const evalEvery = parseInt(arg('eval-every', '1')!, 10);
  const evalN = parseInt(arg('eval-n', '20')!, 10);
  const evalSims = parseInt(arg('eval-sims', '100')!, 10);

  const evalSeeds = Array.from({ length: evalN }, (_, i) => 99_000 + i);

  const RUNS_DIR = resolve(import.meta.dirname, 'runs');
  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const saveTo = resolve(RUNS_DIR, `az-net-${days}D-${stamp}.json`);
  const logPath = resolve(RUNS_DIR, `az-iter-${days}D-${stamp}.json`);

  await iterate({
    days, mode: 'fixed',
    iters, gamesPerIter: games, simsPerMove: sims,
    epochs, batchSize,
    evalEvery, evalSeeds, evalSims,
    saveTo, logPath,
    loadFrom: arg('load'),
  });
  console.log(`[iterate] saved net → ${saveTo}`);
  console.log(`[iterate] log → ${logPath}`);
}

// Run main() if this file is executed directly (the import.meta.url guard
// is fragile on Windows where process.argv[1] uses backslashes).
const argv1 = (process.argv[1] ?? '').replace(/\\/g, '/').toLowerCase();
if (import.meta.url.toLowerCase().includes('iterate.ts') && argv1.includes('iterate.ts')) {
  main();
}
