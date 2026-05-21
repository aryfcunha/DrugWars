// 30D-direct trainer.
//
// Premise: the multi-horizon curriculum (3D→5D→10D→15D→30D) was teaching the
// NN contradictory objectives — survive-debt at short horizons vs aggressively-
// compound at long horizons. We pretrain entirely on 30D, then run self-play
// at 30D with the pretrain samples persistently mixed into the training buffer
// so SGD can't drift away from the analytical anchor.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import { startGame, isTerminal, type FullState, step as simStep } from '../sim';
import { netWorth } from '../../../src/game/state';
import { apply, legalActions } from '../actions';
import { featurize } from '../features';
import { macroToIndex, legalMask, NUM_MACROS } from '../macros';
import { makeNet, trainStep, saveNet, loadNet, saveNetToString, type Net, type Batch, DEFAULT_ADAM } from '../nn';
import { makeAnalyticalAgent } from './agent';
import { DEFAULT_CONFIG, type StrategyConfig } from './config';
import { buildCombatTable, type CombatTable } from './combat';
import { azAgent } from '../agent_az';
import { evalAgent, formatSummary } from '../eval';
import { greedyAgent } from '../agents';

interface Sample {
  x: Float32Array;
  pi: Float32Array;
  mask: Float32Array;
  vTarget: number;
}

function loadCombatTable(): CombatTable {
  const p = resolve('scripts/ai/runs/combat_table.json');
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  const t = buildCombatTable();
  mkdirSync(resolve('scripts/ai/runs'), { recursive: true });
  writeFileSync(p, JSON.stringify(t));
  return t;
}

function shuffleInplace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ─── Analytical demonstration collector (pretrain anchor) ─────────────────

function collectAnalyticalTrajectory(
  combatTable: CombatTable,
  cfg: StrategyConfig,
  seed: number,
  days: number,
  exploreRate: number,
): Sample[] {
  const agent = makeAnalyticalAgent({ combatTable, config: cfg, exploreRate, seed: seed ^ 0xA5 });
  let s: FullState = startGame(seed, days, 'fixed');
  const traj: Sample[] = [];
  const maxTurns = Math.max(200, days * 6);
  let turn = 0;
  while (!isTerminal(s) && turn < maxTurns) {
    const macro = agent.choose(s);
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

// ─── Parallel self-play via worker_threads ────────────────────────────────

interface SerializedSample { x: number[]; pi: number[]; mask: number[]; vTarget: number }

function workerPaths(): { bootstrap: string; target: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    bootstrap: resolve(here, '..', 'worker_bootstrap.mjs'),
    target: pathToFileURL(resolve(here, 'train_30d_worker.ts')).href,
  };
}

async function runWorker(netJson: string, games: { seed: number; days: number; sims: number; dirichletEps: number; earlyTemp: number; earlyTempMoves: number }[]): Promise<SerializedSample[]> {
  return new Promise((res, rej) => {
    const { bootstrap, target } = workerPaths();
    const w = new Worker(bootstrap, { workerData: { target, netJson, games } });
    w.on('message', m => { res((m as { samples: SerializedSample[] }).samples); w.terminate(); });
    w.on('error', rej);
    w.on('exit', code => { if (code !== 0) rej(new Error(`worker exited ${code}`)); });
  });
}

function deserializeSamples(arr: SerializedSample[]): Sample[] {
  return arr.map(s => ({
    x: Float32Array.from(s.x),
    pi: Float32Array.from(s.pi),
    mask: Float32Array.from(s.mask),
    vTarget: s.vTarget,
  }));
}

async function selfplayBatchParallel(net: Net, gamesPerIter: number, iterIndex: number, days: number, sims: number, workers: number): Promise<Sample[]> {
  const allGames = Array.from({ length: gamesPerIter }, (_, g) => ({
    seed: 70_000 + iterIndex * 1000 + g,
    days,
    sims,
    dirichletEps: 0.25,
    earlyTemp: 1.0,
    earlyTempMoves: 3,
  }));
  const W = Math.min(workers, allGames.length);
  const buckets: typeof allGames[] = Array.from({ length: W }, () => []);
  for (let i = 0; i < allGames.length; i++) buckets[i % W].push(allGames[i]);

  const netJson = saveNetToString(net);
  const results = await Promise.all(buckets.map(b => runWorker(netJson, b)));
  const out: Sample[] = [];
  for (const r of results) out.push(...deserializeSamples(r));
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
  const days = parseInt(arg('days', '30')!, 10);
  const pretrainGames = parseInt(arg('pretrain-games', '2000')!, 10);
  const pretrainEpochs = parseInt(arg('pretrain-epochs', '20')!, 10);
  const selfplayIters = parseInt(arg('iters', '8')!, 10);
  const gamesPerIter = parseInt(arg('games', '20')!, 10);
  const sims = parseInt(arg('sims', '200')!, 10);
  const epochsPerIter = parseInt(arg('epochs', '4')!, 10);
  const lr = parseFloat(arg('lr', '5e-4')!);
  const batchSize = 64;
  const pretrainMix = parseFloat(arg('mix', '0.5')!);
  const workers = parseInt(arg('workers', '10')!, 10);
  const loadPretrain = arg('load-pretrain');                    // skip phase 1, load saved net + samples
  const pretrainSamplesPath = arg('load-pretrain-samples');     // saved pretrain samples (for replay mix)
  const runsDir = resolve('scripts/ai/runs');
  if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });

  console.log(`30D-direct trainer  pretrain=${pretrainGames}g×${pretrainEpochs}e  selfplay=${selfplayIters}×${gamesPerIter}g  sims=${sims}  lr=${lr}  mix=${pretrainMix}  workers=${workers}`);

  const combatTable = loadCombatTable();
  const strategy: StrategyConfig = { ...DEFAULT_CONFIG };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  let net: Net;
  let pretrainSamples: Sample[];
  const adamCfg = { ...DEFAULT_ADAM, lr };

  if (loadPretrain && pretrainSamplesPath) {
    console.log(`\n── Phase 1: Loading saved pretrain from ${loadPretrain} ──`);
    net = loadNet(loadPretrain);
    const raw = JSON.parse(readFileSync(pretrainSamplesPath, 'utf8')) as SerializedSample[];
    pretrainSamples = deserializeSamples(raw);
    console.log(`  loaded ${pretrainSamples.length} samples`);
  } else {
    // ── Phase 1: Pretrain on 30D only ──
    console.log(`\n── Phase 1: Pretrain (analytical teacher, days=${days} only) ──`);
    pretrainSamples = [];
    const t0 = performance.now();
    let profitable = 0;
    for (let g = 0; g < pretrainGames; g++) {
      const traj = collectAnalyticalTrajectory(combatTable, strategy, 30_000 + g, days, 0.10);
      pretrainSamples.push(...traj);
      if (traj.length > 0 && traj[0].vTarget > 0) profitable++;
    }
    console.log(`  collected ${pretrainSamples.length} samples from ${pretrainGames} games in ${((performance.now() - t0) / 1000).toFixed(1)}s — ${profitable}/${pretrainGames} profitable`);

    net = makeNet(64);
    const t1 = performance.now();
    let polSum = 0, valSum = 0, steps = 0;
    for (let ep = 0; ep < pretrainEpochs; ep++) {
      shuffleInplace(pretrainSamples);
      for (let i = 0; i < pretrainSamples.length; i += batchSize) {
        const slice = pretrainSamples.slice(i, i + batchSize);
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
      if ((ep + 1) % Math.max(1, Math.floor(pretrainEpochs / 10)) === 0) {
        console.log(`    ep ${ep + 1}/${pretrainEpochs}  polL=${(polSum / steps).toFixed(3)}  valL=${(valSum / steps).toFixed(4)}`);
      }
    }
    console.log(`  pretrain done in ${((performance.now() - t1) / 1000).toFixed(1)}s   final polL=${(polSum / steps).toFixed(3)}  valL=${(valSum / steps).toFixed(4)}`);

    const ptPath = resolve(runsDir, `train30d-pretrain-${stamp}.json`);
    saveNet(net, ptPath);
    // Persist pretrain samples so a parallel restart can skip phase 1
    const samplesPath = resolve(runsDir, `train30d-pretrain-samples-${stamp}.json`);
    writeFileSync(samplesPath, JSON.stringify(pretrainSamples.map(s => ({
      x: Array.from(s.x), pi: Array.from(s.pi), mask: Array.from(s.mask), vTarget: s.vTarget,
    }))));
    console.log(`  saved net → ${ptPath}`);
    console.log(`  saved samples → ${samplesPath}`);
  }

  // ── Phase 2: Self-play with pretrain-anchored buffer ──
  console.log(`\n── Phase 2: Self-play at ${days}D with pretrain-anchored buffer (mix=${pretrainMix}) ──`);

  const selfplaySamples: Sample[] = [];
  const SELFPLAY_BUF_MAX = 20_000;
  const evalSeeds = Array.from({ length: 100 }, (_, i) => 50_000 + i);

  for (let it = 1; it <= selfplayIters; it++) {
    const t0 = performance.now();
    const newSamples = await selfplayBatchParallel(net, gamesPerIter, it, days, sims, workers);
    selfplaySamples.push(...newSamples);
    const added = newSamples.length;
    if (selfplaySamples.length > SELFPLAY_BUF_MAX) selfplaySamples.splice(0, selfplaySamples.length - SELFPLAY_BUF_MAX);
    const tSP = ((performance.now() - t0) / 1000).toFixed(1);

    // Mixed training: each batch has pretrainMix from pretrain samples + (1-mix) from self-play
    const t1 = performance.now();
    let polLoss = 0, valLoss = 0, trsteps = 0;
    const ptCount = Math.floor(batchSize * pretrainMix);
    const spCount = batchSize - ptCount;
    const batchesPerEpoch = Math.floor(selfplaySamples.length / spCount);
    for (let ep = 0; ep < epochsPerIter; ep++) {
      for (let b = 0; b < batchesPerEpoch; b++) {
        const batch: Sample[] = [];
        for (let i = 0; i < ptCount; i++) batch.push(pretrainSamples[(Math.random() * pretrainSamples.length) | 0]);
        for (let i = 0; i < spCount; i++) batch.push(selfplaySamples[(Math.random() * selfplaySamples.length) | 0]);
        const loss = trainStep(net, {
          x: batch.map(s => s.x),
          piTarget: batch.map(s => s.pi),
          mask: batch.map(s => s.mask),
          vTarget: batch.map(s => s.vTarget),
        }, adamCfg);
        polLoss += loss.policyLoss;
        valLoss += loss.valueLoss;
        trsteps++;
      }
    }
    const tTr = ((performance.now() - t1) / 1000).toFixed(1);

    console.log(`  iter ${it}/${selfplayIters}  sp_buf=${selfplaySamples.length}  +${added} samples  polL=${(polLoss / trsteps).toFixed(3)}  valL=${(valLoss / trsteps).toFixed(4)}  sp=${tSP}s  tr=${tTr}s`);

    // Eval every iter on a moderate seed set
    const t2 = performance.now();
    const az = azAgent(net, { simulations: sims, dirichletEps: 0, temperature: 0 });
    const sum = evalAgent(az, { days, mode: 'fixed', seeds: evalSeeds });
    console.log(`    ${formatSummary(sum)}  (${((performance.now() - t2) / 1000).toFixed(1)}s)`);
  }

  const finalPath = resolve(runsDir, `train30d-final-${stamp}.json`);
  saveNet(net, finalPath);

  // ── Baselines for comparison ──
  console.log(`\n── Baselines on identical eval seeds ──`);
  const baseAnalytical = evalAgent(makeAnalyticalAgent({ combatTable, config: strategy }), { days, mode: 'fixed', seeds: evalSeeds });
  const baseGreedy = evalAgent(greedyAgent(), { days, mode: 'fixed', seeds: evalSeeds });
  console.log(`  ${formatSummary(baseAnalytical)}`);
  console.log(`  ${formatSummary(baseGreedy)}`);

  console.log(`\nFinal net: ${finalPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
