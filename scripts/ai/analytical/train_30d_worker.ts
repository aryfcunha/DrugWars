// Worker for parallel self-play in train_30d.ts.
// Receives net JSON + a list of game configs, plays the games, posts back samples.

import { parentPort, workerData } from 'node:worker_threads';

import { startGame, isTerminal, type FullState, step as simStep } from '../sim';
import { netWorth } from '../../../src/game/state';
import { apply } from '../actions';
import { featurize } from '../features';
import { loadNetFromString, type Net } from '../nn';
import { azSelfplayMove, DEFAULT_AZ } from '../agent_az';

interface WorkerInput {
  netJson: string;
  games: { seed: number; days: number; sims: number; dirichletEps: number; earlyTemp: number; earlyTempMoves: number }[];
}

interface SerializedSample {
  x: number[];
  pi: number[];
  mask: number[];
  vTarget: number;
}

function playOne(net: Net, gc: WorkerInput['games'][number]): SerializedSample[] {
  let s: FullState = startGame(gc.seed, gc.days, 'fixed');
  const traj: { x: Float32Array; pi: Float32Array; mask: Float32Array }[] = [];
  const maxTurns = Math.max(200, gc.days * 6);
  let turn = 0;
  while (!isTerminal(s) && turn < maxTurns) {
    const T = turn < gc.earlyTempMoves ? gc.earlyTemp : 0;
    const move = azSelfplayMove(net, s, {
      ...DEFAULT_AZ,
      simulations: gc.sims,
      dirichletEps: gc.dirichletEps,
      temperature: T,
    });
    if (!move) break;
    traj.push({ x: featurize(s), pi: move.pi, mask: move.mask });
    for (const a of apply(s, move.macro)) s = simStep(s, a);
    turn++;
  }
  const v = Math.tanh(netWorth(s) / 30_000);
  return traj.map(t => ({
    x: Array.from(t.x),
    pi: Array.from(t.pi),
    mask: Array.from(t.mask),
    vTarget: v,
  }));
}

const input = workerData as WorkerInput;
const net = loadNetFromString(input.netJson);
const out: SerializedSample[] = [];
for (const gc of input.games) out.push(...playOne(net, gc));
parentPort!.postMessage({ samples: out });
