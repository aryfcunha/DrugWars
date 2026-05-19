// Pretrain the network on greedy-agent demonstrations.
//
// Motivation: AZ self-play from random init takes thousands of games to push
// the policy head's cross-entropy meaningfully below uniform. Greedy is a
// decent (if imperfect) heuristic — using it as a teacher gives the network
// a strong warm start. After pretraining the policy head can be fine-tuned
// via AZ self-play, which now converges much faster.
//
// We collect (state_features, greedy_action_one_hot, legal_mask, return)
// from many greedy games and train both heads:
//   policy: cross-entropy(logits, greedy_action_one_hot)  — imitation
//   value:  MSE(v_pred, tanh(final_nw / 30k))             — return prediction

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { startGame, isTerminal, type FullState, step as simStep } from './sim.ts';
import { netWorth } from '../../src/game/state.ts';
import { apply } from './actions.ts';
import { greedyChoose } from './agents.ts';
import { featurize } from './features.ts';
import { macroToIndex, legalMask, NUM_MACROS } from './macros.ts';
import { makeNet, trainStep, saveNet, loadNet, type Net, type Batch, DEFAULT_ADAM } from './nn.ts';

interface Sample {
  x: Float32Array;
  pi: Float32Array;      // one-hot greedy action
  mask: Float32Array;
  vTarget: number;
}

import { legalActions } from './actions.ts';

function collectGreedyTrajectorySync(seed: number, days: number, mode: 'fixed' | 'endless'): Sample[] {
  let s: FullState = startGame(seed, days, mode);
  const traj: Sample[] = [];
  const maxTurns = Math.max(200, days * 6);
  let turn = 0;
  while (!isTerminal(s) && turn < maxTurns) {
    const macro = greedyChoose(s);
    if (!macro) break;
    const idx = macroToIndex(macro);
    const pi = new Float32Array(NUM_MACROS);
    pi[idx] = 1.0;
    const allLegal = legalActions(s);
    const fullMask = legalMask(allLegal);
    traj.push({ x: featurize(s), pi, mask: fullMask, vTarget: 0 });
    for (const a of apply(s, macro)) s = simStep(s, a);
    turn++;
  }
  const v = Math.tanh(netWorth(s) / 30_000);
  for (const sample of traj) sample.vTarget = v;
  return traj;
}

function shuffleInplace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export interface PretrainCfg {
  games: number;
  days: number[];         // sample seeds across these horizons for diversity
  mode: 'fixed' | 'endless';
  epochs: number;
  batchSize: number;
  lr: number;
  saveTo?: string;
  loadFrom?: string;
}

export async function pretrain(cfg: PretrainCfg): Promise<Net> {
  const net: Net = cfg.loadFrom ? loadNet(cfg.loadFrom) : makeNet(64);
  console.log(`[pretrain] games=${cfg.games} days=${cfg.days.join(',')} mode=${cfg.mode}`);

  // Collect greedy demonstrations
  const samples: Sample[] = [];
  const t0 = performance.now();
  for (let g = 0; g < cfg.games; g++) {
    const days = cfg.days[g % cfg.days.length];
    const traj = collectGreedyTrajectorySync(30_000 + g, days, cfg.mode);
    samples.push(...traj);
  }
  const tCol = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`  collected ${samples.length} samples in ${tCol}s`);

  // Train
  const t1 = performance.now();
  const adamCfg = { ...DEFAULT_ADAM, lr: cfg.lr };
  let polSum = 0, valSum = 0, steps = 0;
  for (let ep = 0; ep < cfg.epochs; ep++) {
    shuffleInplace(samples);
    for (let i = 0; i < samples.length; i += cfg.batchSize) {
      const slice = samples.slice(i, i + cfg.batchSize);
      const batch: Batch = {
        x: slice.map(s => s.x),
        piTarget: slice.map(s => s.pi),
        mask: slice.map(s => s.mask),
        vTarget: slice.map(s => s.vTarget),
      };
      const loss = trainStep(net, batch, adamCfg);
      polSum += loss.policyLoss;
      valSum += loss.valueLoss;
      steps++;
    }
    if ((ep + 1) % Math.max(1, Math.floor(cfg.epochs / 10)) === 0) {
      console.log(`    ep ${ep + 1}/${cfg.epochs}  polL=${(polSum / steps).toFixed(3)}  valL=${(valSum / steps).toFixed(4)}`);
    }
  }
  const tTr = ((performance.now() - t1) / 1000).toFixed(1);
  console.log(`  trained ${steps} batches in ${tTr}s`);
  console.log(`  final  polL=${(polSum / steps).toFixed(3)}  valL=${(valSum / steps).toFixed(4)}`);

  if (cfg.saveTo) {
    saveNet(net, cfg.saveTo);
    console.log(`  saved → ${cfg.saveTo}`);
  }
  return net;
}

// CLI entry
function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
}

async function main() {
  const games = parseInt(arg('games', '200')!, 10);
  const epochs = parseInt(arg('epochs', '10')!, 10);
  const batchSize = parseInt(arg('batch', '64')!, 10);
  const lr = parseFloat(arg('lr', '1e-3')!);
  const daysStr = arg('days', '3,5,10,15')!;
  const days = daysStr.split(',').map(s => parseInt(s.trim(), 10));

  const RUNS_DIR = resolve(import.meta.dirname, 'runs');
  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const saveTo = resolve(RUNS_DIR, `az-pretrain-${stamp}.json`);

  await pretrain({
    games, days, mode: 'fixed',
    epochs, batchSize, lr,
    saveTo,
    loadFrom: arg('load'),
  });
  console.log(`[pretrain] done → ${saveTo}`);
}

// Run if invoked directly
const argv1 = (process.argv[1] ?? '').replace(/\\/g, '/').toLowerCase();
if (import.meta.url.toLowerCase().includes('pretrain.ts') && argv1.includes('pretrain.ts')) {
  main();
}
