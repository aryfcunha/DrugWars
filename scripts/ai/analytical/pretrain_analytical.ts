// Pretrain using the analytical agent as the teacher.
// Mirrors scripts/ai/pretrain.ts but swaps greedyChoose → analyticalChoose,
// reads the cached combat table, and uses the StrategyConfig flags.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startGame, isTerminal, type FullState, step as simStep } from '../sim';
import { netWorth } from '../../../src/game/state';
import { apply, legalActions } from '../actions';
import { featurize } from '../features';
import { macroToIndex, legalMask, NUM_MACROS } from '../macros';
import { makeNet, trainStep, saveNet, loadNet, type Net, type Batch, DEFAULT_ADAM } from '../nn';
import { makeAnalyticalAgent } from './agent';
import { DEFAULT_CONFIG, type StrategyConfig } from './config';
import { buildCombatTable, type CombatTable } from './combat';

interface Sample {
  x: Float32Array;
  pi: Float32Array;
  mask: Float32Array;
  vTarget: number;
}

function loadCombatTable(): CombatTable {
  const p = resolve('scripts/ai/runs/combat_table.json');
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  console.log('[pretrain] building combat table (~15s)...');
  const t = buildCombatTable();
  mkdirSync(resolve('scripts/ai/runs'), { recursive: true });
  writeFileSync(p, JSON.stringify(t));
  return t;
}

function collectAnalyticalTrajectory(
  combatTable: CombatTable,
  cfg: StrategyConfig,
  seed: number,
  days: number,
  mode: 'fixed' | 'endless',
  exploreRate: number,
): Sample[] {
  const agent = makeAnalyticalAgent({ combatTable, config: cfg, exploreRate, seed: seed ^ 0xA5 });
  let s: FullState = startGame(seed, days, mode);
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

function shuffleInplace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export interface AnalyticalPretrainCfg {
  games: number;
  days: number[];
  mode: 'fixed' | 'endless';
  epochs: number;
  batchSize: number;
  lr: number;
  exploreRate?: number;
  strategy?: Partial<StrategyConfig>;
  saveTo?: string;
  loadFrom?: string;
}

export async function pretrainAnalytical(cfg: AnalyticalPretrainCfg): Promise<Net> {
  const net: Net = cfg.loadFrom ? loadNet(cfg.loadFrom) : makeNet(64);
  const strategy: StrategyConfig = { ...DEFAULT_CONFIG, ...(cfg.strategy ?? {}) };
  const combatTable = loadCombatTable();
  const exploreRate = cfg.exploreRate ?? 0.15;

  console.log(`[pretrain-analytical] games=${cfg.games} days=${cfg.days.join(',')} mode=${cfg.mode} explore=${exploreRate}`);

  const samples: Sample[] = [];
  const t0 = performance.now();
  let positiveReturns = 0;
  for (let g = 0; g < cfg.games; g++) {
    const days = cfg.days[g % cfg.days.length];
    const traj = collectAnalyticalTrajectory(combatTable, strategy, 30_000 + g, days, cfg.mode, exploreRate);
    samples.push(...traj);
    if (traj.length > 0 && traj[0].vTarget > 0) positiveReturns++;
  }
  const tCol = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`  collected ${samples.length} samples in ${tCol}s — ${positiveReturns}/${cfg.games} games profitable`);

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

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
}

async function main() {
  const games = parseInt(arg('games', '200')!, 10);
  const epochs = parseInt(arg('epochs', '10')!, 10);
  const batchSize = parseInt(arg('batch', '64')!, 10);
  const lr = parseFloat(arg('lr', '1e-3')!);
  const daysStr = arg('days', '3,5,10,15,30')!;
  const days = daysStr.split(',').map(s => parseInt(s.trim(), 10));
  const explore = parseFloat(arg('explore', '0.15')!);

  const RUNS_DIR = resolve(import.meta.dirname, '..', 'runs');
  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const saveTo = resolve(RUNS_DIR, `az-pretrain-analytical-${stamp}.json`);

  await pretrainAnalytical({
    games, days, mode: 'fixed',
    epochs, batchSize, lr,
    exploreRate: explore,
    saveTo,
    loadFrom: arg('load'),
  });
  console.log(`[pretrain-analytical] done → ${saveTo}`);
}

function isMain() {
  const argv1 = process.argv[1]?.replace(/\\/g, '/');
  const url = import.meta.url.replace(/\\/g, '/');
  return argv1 && (url.endsWith(argv1) || url === `file:///${argv1}` || url === `file://${argv1}`);
}
if (isMain()) main();
