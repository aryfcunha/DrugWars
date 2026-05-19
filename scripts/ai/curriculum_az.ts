// Curriculum runner for the AlphaZero (v2/v3) agent.
//
// Chains AZ training across progressively longer horizons:
//   3D → 5D → 10D → 15D → 30D → 60D → 90D → endless
//
// Each rung loads the previous rung's network weights, then trains via
// self-play + SGD on its own horizon. Total wall-clock budget scales with
// horizon (longer games are slower per iter but need fewer iters since the
// network is already warm).
//
// Submission naming: AI_AZ_v<N> (e.g., AI_AZ_v3) at each rung's days bucket.
//
// Run:
//   npx tsx scripts/ai/curriculum_az.ts                    # full curriculum
//   npx tsx scripts/ai/curriculum_az.ts --quick            # fast validation
//   npx tsx scripts/ai/curriculum_az.ts --only 3 --submit  # just the 15D rung
//   npx tsx scripts/ai/curriculum_az.ts --start 0 --end 4  # 3D..15D inclusive

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { iterate } from './iterate.ts';
import { saveNet, loadNet } from './nn.ts';
import { evalAgent, formatSummary } from './eval.ts';
import { azAgent } from './agent_az.ts';
import { greedyAgent, mctsAgent } from './agents.ts';
import { submit } from './submit.ts';
import { pretrain } from './pretrain.ts';

const RUNS_DIR = resolve(import.meta.dirname, 'runs');
const VERSION = parseInt(process.env.AI_VERSION ?? '3', 10);

interface Rung {
  days: number;
  mode: 'fixed' | 'endless';
  iters: number;
  gamesPerIter: number;
  simsPerMove: number;
  epochs: number;
  evalSims: number;
}

const QUICK = process.argv.includes('--quick');

// Curriculum: short → long. Iters/games shrink at long horizons (each game
// takes K× longer so per-iter cost is K× too). Sims/move scale slightly with
// horizon (more decisions = more compute per game).
const CURRICULUM: Rung[] = QUICK ? [
  { days: 3,  mode: 'fixed',   iters: 3, gamesPerIter: 10, simsPerMove: 80,  epochs: 3, evalSims: 100 },
  { days: 5,  mode: 'fixed',   iters: 3, gamesPerIter: 10, simsPerMove: 90,  epochs: 3, evalSims: 100 },
  { days: 10, mode: 'fixed',   iters: 2, gamesPerIter: 6,  simsPerMove: 100, epochs: 3, evalSims: 120 },
  { days: 15, mode: 'fixed',   iters: 2, gamesPerIter: 6,  simsPerMove: 120, epochs: 3, evalSims: 150 },
] : [
  { days: 3,  mode: 'fixed',   iters: 6, gamesPerIter: 25, simsPerMove: 100, epochs: 4, evalSims: 150 },
  { days: 5,  mode: 'fixed',   iters: 5, gamesPerIter: 20, simsPerMove: 120, epochs: 4, evalSims: 180 },
  { days: 10, mode: 'fixed',   iters: 5, gamesPerIter: 15, simsPerMove: 140, epochs: 4, evalSims: 200 },
  { days: 15, mode: 'fixed',   iters: 4, gamesPerIter: 12, simsPerMove: 160, epochs: 4, evalSims: 220 },
  { days: 30, mode: 'fixed',   iters: 3, gamesPerIter: 8,  simsPerMove: 180, epochs: 3, evalSims: 250 },
  { days: 60, mode: 'fixed',   iters: 2, gamesPerIter: 6,  simsPerMove: 200, epochs: 3, evalSims: 280 },
  { days: 90, mode: 'fixed',   iters: 2, gamesPerIter: 5,  simsPerMove: 220, epochs: 3, evalSims: 300 },
  { days: 0,  mode: 'endless', iters: 2, gamesPerIter: 5,  simsPerMove: 200, epochs: 3, evalSims: 250 },
];

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
}

async function main() {
  const onlyIdx = arg('only');
  const startIdx = parseInt(arg('start', '0')!, 10);
  const endIdx = parseInt(arg('end', String(CURRICULUM.length - 1))!, 10);
  const doSubmit = process.argv.includes('--submit');
  const loadInit = arg('load');

  const indices = onlyIdx != null
    ? [parseInt(onlyIdx, 10)]
    : Array.from({ length: endIdx - startIdx + 1 }, (_, i) => startIdx + i);

  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = resolve(RUNS_DIR, `curriculum-az-${stamp}.jsonl`);
  console.log(`[curriculum_az] v${VERSION} submit=${doSubmit} rungs=${indices.join(',')} log=${logPath}`);
  console.log('');

  let prevNetPath: string | undefined = loadInit;

  // Pretrain step (unless explicitly disabled or a starting net was provided).
  // Greedy demonstrations bootstrap the policy head from ~uniform CE to ~0.85,
  // which dramatically accelerates downstream self-play convergence.
  if (!loadInit && !process.argv.includes('--no-pretrain')) {
    console.log(`──── Pretrain (greedy demos) ────`);
    const pretrainPath = resolve(RUNS_DIR, `az-v${VERSION}-pretrain-${stamp}.json`);
    const games = QUICK ? 80 : 250;
    const epochs = QUICK ? 5 : 8;
    await pretrain({
      games, days: [3, 5, 10, 15], mode: 'fixed',
      epochs, batchSize: 64, lr: 1e-3,
      saveTo: pretrainPath,
    });
    prevNetPath = pretrainPath;
    console.log('');
  }

  for (const idx of indices) {
    const r = CURRICULUM[idx];
    const tag = r.mode === 'endless' ? '∞' : `${r.days}D`;
    console.log(`──── Rung ${tag} (idx ${idx}) ──── ${r.iters} iters × ${r.gamesPerIter} games × ${r.simsPerMove} sims`);
    if (prevNetPath) console.log(`      transfer init from ${prevNetPath}`);

    const evalSeeds = Array.from({ length: 20 }, (_, i) => 99_000 + i);
    const saveTo = resolve(RUNS_DIR, `az-v${VERSION}-${r.days}D-${stamp}.json`);

    const t0 = performance.now();
    const { net, results } = await iterate({
      days: r.days,
      mode: r.mode,
      iters: r.iters,
      gamesPerIter: r.gamesPerIter,
      simsPerMove: r.simsPerMove,
      epochs: r.epochs,
      batchSize: 32,
      evalEvery: r.iters,           // only eval at end of rung to save time
      evalSeeds,
      evalSims: r.evalSims,
      saveTo,
      loadFrom: prevNetPath,
    });
    saveNet(net, saveTo);
    prevNetPath = saveTo;
    const dt = ((performance.now() - t0) / 1000 / 60).toFixed(1);
    console.log(`      rung complete in ${dt} min  → ${saveTo}`);

    // Compute a definitive eval (matched seed set, AZ vs greedy vs MCTS)
    const az = azAgent(net, { simulations: r.evalSims, dirichletEps: 0, temperature: 0 });
    const greedy = greedyAgent();
    const mcts = mctsAgent({ simulations: r.evalSims * 2 });

    const evalAz = evalAgent(az, { days: r.days, mode: r.mode, seeds: evalSeeds });
    const evalGr = evalAgent(greedy, { days: r.days, mode: r.mode, seeds: evalSeeds });
    const evalMc = evalAgent(mcts, { days: r.days, mode: r.mode, seeds: evalSeeds });
    console.log('   ' + formatSummary(evalAz));
    console.log('   ' + formatSummary(evalGr));
    console.log('   ' + formatSummary(evalMc));

    // Submit best AZ run + best Greedy/MCTS (for context)
    const submitted: { name: string; nw: number; days: number }[] = [];
    if (doSubmit) {
      const submitDays = (r: typeof evalAz.results[number]) =>
        CURRICULUM[idx].mode === 'endless' ? r.days : CURRICULUM[idx].days;
      const bestAz = evalAz.results.reduce((a, b) => b.netWorth > a.netWorth ? b : a);
      const bestMc = evalMc.results.reduce((a, b) => b.netWorth > a.netWorth ? b : a);
      const bestGr = evalGr.results.reduce((a, b) => b.netWorth > a.netWorth ? b : a);

      const azName = `AI_AZ_v${VERSION}`.slice(0, 16);
      const mcName = `AI_MCTS_v${VERSION}`.slice(0, 16);
      const grName = `AI_GREEDY_v${VERSION}`.slice(0, 16);

      const okAZ = await submit(azName, bestAz.netWorth, submitDays(bestAz), r.mode);
      const okMC = await submit(mcName, bestMc.netWorth, submitDays(bestMc), r.mode);
      const okGR = await submit(grName, bestGr.netWorth, submitDays(bestGr), r.mode);
      if (okAZ) submitted.push({ name: azName, nw: bestAz.netWorth, days: submitDays(bestAz) });
      if (okMC) submitted.push({ name: mcName, nw: bestMc.netWorth, days: submitDays(bestMc) });
      if (okGR) submitted.push({ name: grName, nw: bestGr.netWorth, days: submitDays(bestGr) });
    }

    // Persist a log entry
    const logEntry = {
      timestamp: new Date().toISOString(),
      version: VERSION,
      rungIdx: idx,
      rung: r,
      iterLog: results,
      az: { mean: evalAz.mean, median: evalAz.median, max: evalAz.max, deathRate: evalAz.deathRate },
      greedy: { mean: evalGr.mean, median: evalGr.median, max: evalGr.max, deathRate: evalGr.deathRate },
      mcts: { mean: evalMc.mean, median: evalMc.median, max: evalMc.max, deathRate: evalMc.deathRate },
      submitted,
      netPath: saveTo,
    };
    writeFileSync(logPath, JSON.stringify(logEntry) + '\n', { flag: 'a' });
    console.log('');
  }

  console.log(`[curriculum_az] done → ${logPath}`);
}

main();
