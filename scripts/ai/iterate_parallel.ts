// Parallel self-play orchestrator. Mirrors iterate.ts but distributes games
// across N worker threads. SGD training and eval stay single-threaded.
//
// Use when MCTS sims/move × games/iter is large enough that game generation
// dominates the loop (i.e. anywhere from 10D upward in the curriculum).

import { Worker } from 'node:worker_threads';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { saveNet, loadNet, makeNet, trainStep, saveNetToString, type Net, type Batch } from './nn';
import { azAgent } from './agent_az';
import { greedyAgent, mctsAgent } from './agents';
import { evalAgent, formatSummary } from './eval';

interface SelfPlaySample {
  x: Float32Array;
  pi: Float32Array;
  mask: Float32Array;
  finalValue: number;
}

interface SerializedSample {
  x: number[]; pi: number[]; mask: number[]; vTarget: number;
}

function shuffleInplace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function workerPaths(): { bootstrap: string; target: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    bootstrap: resolve(here, 'worker_bootstrap.mjs'),
    target: pathToFileURL(resolve(here, 'iterate_worker.ts')).href,
  };
}

async function runWorker(netJson: string, games: Array<{
  seed: number; days: number; mode: 'fixed' | 'endless';
  sims: number; dirichletEps: number; earlyTemp: number; earlyTempMoves: number;
}>): Promise<SerializedSample[]> {
  return new Promise((res, rej) => {
    const { bootstrap, target } = workerPaths();
    const w = new Worker(bootstrap, { workerData: { target, netJson, games } });
    w.on('message', m => { res((m as { samples: SerializedSample[] }).samples); w.terminate(); });
    w.on('error', rej);
    w.on('exit', code => { if (code !== 0) rej(new Error(`worker exited ${code}`)); });
  });
}

function deserializeSamples(arr: SerializedSample[]): SelfPlaySample[] {
  return arr.map(s => ({
    x: Float32Array.from(s.x),
    pi: Float32Array.from(s.pi),
    mask: Float32Array.from(s.mask),
    finalValue: s.vTarget,
  }));
}

export interface ParallelIterCfg {
  days: number;
  mode: 'fixed' | 'endless';
  iters: number;
  gamesPerIter: number;
  simsPerMove: number;
  epochs: number;
  batchSize: number;
  evalEvery: number;
  evalSeeds: number[];
  evalSims: number;
  workers: number;
  loadFrom?: string;
  saveTo?: string;
}

export async function iterateParallel(cfg: ParallelIterCfg): Promise<{ net: Net; results: any[] }> {
  const net: Net = cfg.loadFrom ? loadNet(cfg.loadFrom) : makeNet(64);
  const results: any[] = [];
  const buf: SelfPlaySample[] = [];
  const BUF_MAX = 20_000;

  console.log(`[iterate_parallel] days=${cfg.days} mode=${cfg.mode} iters=${cfg.iters} games/iter=${cfg.gamesPerIter} sims/move=${cfg.simsPerMove} workers=${cfg.workers}`);

  for (let it = 1; it <= cfg.iters; it++) {
    const t0 = performance.now();

    // Build the list of game configs for this iteration
    const allGames: Array<{ seed: number; days: number; mode: 'fixed' | 'endless'; sims: number; dirichletEps: number; earlyTemp: number; earlyTempMoves: number }> = [];
    for (let g = 0; g < cfg.gamesPerIter; g++) {
      allGames.push({
        seed: 10_000 + it * 1000 + g,
        days: cfg.days,
        mode: cfg.mode,
        sims: cfg.simsPerMove,
        dirichletEps: 0.25,
        earlyTemp: 1.0,
        earlyTempMoves: 3,
      });
    }

    // Partition games across workers
    const W = Math.min(cfg.workers, allGames.length);
    const buckets: typeof allGames[] = Array.from({ length: W }, () => []);
    for (let i = 0; i < allGames.length; i++) buckets[i % W].push(allGames[i]);

    const netJson = saveNetToString(net);

    const promises = buckets.map(b => runWorker(netJson, b));
    const allResults = await Promise.all(promises);
    let added = 0;
    for (const r of allResults) {
      const samples = deserializeSamples(r);
      buf.push(...samples);
      added += samples.length;
    }
    if (buf.length > BUF_MAX) buf.splice(0, buf.length - BUF_MAX);
    const tSP = ((performance.now() - t0) / 1000).toFixed(1);

    // Train (single-threaded as before)
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
          vTarget: slice.map(s => s.finalValue),
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
    console.log(`  iter ${it}/${cfg.iters}  buf=${buf.length}  +${added} samples  polL=${meanPol.toFixed(3)}  valL=${meanVal.toFixed(4)}  sp=${tSP}s  tr=${tTr}s`);

    if (it % cfg.evalEvery === 0 || it === cfg.iters) {
      const t2 = performance.now();
      const az = azAgent(net, { simulations: cfg.evalSims, dirichletEps: 0, temperature: 0 });
      const sum = evalAgent(az, { days: cfg.days, mode: cfg.mode, seeds: cfg.evalSeeds });
      console.log('    ' + formatSummary(sum) + `  (${((performance.now() - t2) / 1000).toFixed(1)}s)`);
      results.push({ iter: it, polLoss: meanPol, valLoss: meanVal, eval: { mean: sum.mean, median: sum.median, max: sum.max, deathRate: sum.deathRate } });
    }
    if (cfg.saveTo) saveNet(net, cfg.saveTo);
  }

  console.log('  baselines:');
  const greedy = evalAgent(greedyAgent(), { days: cfg.days, mode: cfg.mode, seeds: cfg.evalSeeds });
  const mcts = evalAgent(mctsAgent({ simulations: cfg.evalSims * 3 }), { days: cfg.days, mode: cfg.mode, seeds: cfg.evalSeeds });
  console.log('    ' + formatSummary(greedy));
  console.log('    ' + formatSummary(mcts));

  return { net, results };
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
}

async function main() {
  const days = parseInt(arg('days', '15')!, 10);
  const iters = parseInt(arg('iters', '3')!, 10);
  const games = parseInt(arg('games', '20')!, 10);
  const sims = parseInt(arg('sims', '120')!, 10);
  const workers = parseInt(arg('workers', '10')!, 10);

  const evalSeeds = Array.from({ length: 20 }, (_, i) => 99_000 + i);

  await iterateParallel({
    days,
    mode: 'fixed',
    iters,
    gamesPerIter: games,
    simsPerMove: sims,
    epochs: 3,
    batchSize: 32,
    evalEvery: iters,
    evalSeeds,
    evalSims: 200,
    workers,
    loadFrom: arg('load'),
    saveTo: arg('save'),
  });
}

function isMain() {
  const argv1 = process.argv[1]?.replace(/\\/g, '/');
  const url = import.meta.url.replace(/\\/g, '/');
  return argv1 && (url.endsWith(argv1) || url === `file:///${argv1}` || url === `file://${argv1}`);
}
if (isMain()) main();
