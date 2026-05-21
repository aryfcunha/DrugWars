// Telemetry layer: collect rich per-game traces during eval runs.
// Layer 1 = RunSummary (1 row/game), Layer 2 = TurnSample (every turn),
// Layer 3 = DecisionLog (at forks only).
//
// JSONL outputs go to scripts/ai/analytical/runs/<experiment>/.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { startGame, isTerminal, step as simStep, type FullState } from '../sim';
import { netWorth, inventoryUsed } from '../../../src/game/state';
import { DRUGS, DRUG_BY_ID, type EventKind } from '../../../src/game/data';
import { type Macro, apply } from '../actions';
import { type Agent } from '../agents';
import { estimateInventoryValue } from './values';

// ─── Types ─────────────────────────────────────────────────────────────────

type MacroKind = Macro['kind'];

export interface RunSummary {
  seed: number;
  horizon: number;
  agent: string;
  config_hash: string;
  alive: boolean;
  days_played: number;
  turn_count: number;
  cause_of_death: 'cops' | 'horizon' | 'alive' | 'unknown';

  net_worth: number;
  peak_net_worth: number;
  peak_day: number;

  total_buys: number;
  total_sells: number;
  total_spent_drugs: number;
  total_revenue_drugs: number;
  total_coat_spend: number;
  total_debt_paid: number;
  total_deposited: number;
  total_withdrawn: number;
  total_gun_accept_spend: number;
  final_debt: number;
  final_bank: number;
  final_cash: number;
  final_capacity: number;
  final_guns: number;

  count_by_macro: Partial<Record<MacroKind, number>>;

  cop_encounters: number;
  fights_chosen: number;
  runs_chosen: number;
  hp_lost_total: number;
  drug_units_dropped: number;
  loot_received_total: number;

  events_total: number;
  events_by_kind: Partial<Record<EventKind, number>>;
  event_offers_seen: number;
  event_offers_accepted: number;
}

export interface TurnSample {
  day: number;
  cash: number;
  bank: number;
  debt: number;
  inv_value: number;
  net_worth: number;
  capacity: number;
  inv_used: number;
  hp: number;
  guns: number;
  loc: string;
  macro: string;
}

export interface DecisionLog {
  day: number;
  phase: string;
  legal_actions: string[];
  chosen: string;
  meta?: Record<string, unknown>;
}

export interface RunTrace {
  summary: RunSummary;
  trajectory: TurnSample[];
  decisions: DecisionLog[];
}

// ─── Hook into agent ──────────────────────────────────────────────────────

export interface TelemetryConfig {
  collectTrajectory?: boolean; // default true
  collectDecisions?: boolean;  // default true
  trajectoryStride?: number;   // sample every N turns (default 1)
}

function macroToStr(m: Macro): string {
  switch (m.kind) {
    case 'BUY_MAX':       return `BUY_MAX:${m.drug}`;
    case 'BUY_HALF':      return `BUY_HALF:${m.drug}`;
    case 'SELL_ALL':      return `SELL_ALL:${m.drug}`;
    case 'SELL_HALF':     return `SELL_HALF:${m.drug}`;
    case 'TRAVEL':        return `TRAVEL:${m.locationId}`;
    default:              return m.kind;
  }
}

/** Run a single game with full telemetry. */
export function runOne(
  agent: Agent,
  seed: number,
  totalDays: number,
  mode: 'fixed' | 'endless' = 'fixed',
  configHash = '',
  cfg: TelemetryConfig = {},
): RunTrace {
  const collectTraj = cfg.collectTrajectory ?? true;
  const collectDec = cfg.collectDecisions ?? true;
  const stride = cfg.trajectoryStride ?? 1;

  const trajectory: TurnSample[] = [];
  const decisions: DecisionLog[] = [];
  const countByMacro: Partial<Record<MacroKind, number>> = {};
  const eventsByKind: Partial<Record<EventKind, number>> = {};

  let s: FullState = startGame(seed, totalDays, mode);
  let prev: FullState = s;

  let total_buys = 0, total_sells = 0;
  let total_spent_drugs = 0, total_revenue_drugs = 0;
  let total_coat_spend = 0, total_debt_paid = 0;
  let total_deposited = 0, total_withdrawn = 0;
  let total_gun_accept_spend = 0;
  let peak_net_worth = netWorth(s), peak_day = s.day;
  let cop_encounters = 0, fights_chosen = 0, runs_chosen = 0;
  let hp_lost_total = 0, drug_units_dropped = 0, loot_received_total = 0;
  let events_total = 0, event_offers_seen = 0, event_offers_accepted = 0;
  let cause_of_death: RunSummary['cause_of_death'] = 'alive';

  // Track event observations by watching pendingEventGenerated transitions
  let lastSeenEventKind: EventKind | null = null;

  // Endless mode: enough room for ~200 days at ~30 actions/day (the agent
  // does many BUY/SELL/coat actions between TRAVELs since only travel
  // advances the day).
  const maxTurns = mode === 'endless' ? 6000 : Math.max(200, totalDays * 6);
  let turn = 0;

  while (!isTerminal(s) && turn < maxTurns) {
    // Capture event kinds when we land on an event phase
    if (s.phase === 'event' && s.pendingEventGenerated && s.pendingEventGenerated.kind !== lastSeenEventKind) {
      const k = s.pendingEventGenerated.kind;
      eventsByKind[k] = (eventsByKind[k] ?? 0) + 1;
      events_total++;
      if (s.pendingEventGenerated.offer) event_offers_seen++;
      lastSeenEventKind = k;
    }
    if (s.phase === 'fighting_cops' && prev.phase !== 'fighting_cops') {
      cop_encounters++;
    }
    if (s.phase !== 'event') lastSeenEventKind = null;

    const macro = agent.choose(s);
    if (!macro) break;
    countByMacro[macro.kind] = (countByMacro[macro.kind] ?? 0) + 1;

    if (collectDec && shouldLogDecision(s, macro)) {
      decisions.push({
        day: s.day,
        phase: s.phase,
        legal_actions: [], // filled below if needed; left empty to keep size down
        chosen: macroToStr(macro),
      });
    }

    if (collectTraj && (turn % stride === 0)) {
      trajectory.push(snapshot(s, macroToStr(macro)));
    }

    // Track money flows by inspecting the macro and pre/post state
    const preCash = s.cash;
    const preDebt = s.debt;
    const preBank = s.bank;
    const preHp = s.hp;
    const preInvDrugs = totalDrugUnits(s);
    const preFighting = s.phase === 'fighting_cops';
    const preEventOffer = s.phase === 'event' && !!s.pendingEventGenerated?.offer;

    const acts = apply(s, macro);
    if (!acts.length) { turn++; continue; }
    prev = s;
    for (const a of acts) s = simStep(s, a);

    // Detect cause-of-death: cops vs horizon
    if (s.phase === 'game_over' && preHp > 0 && s.hp <= 0) {
      cause_of_death = 'cops';
    } else if (s.phase === 'game_over' && s.day >= totalDays && s.hp > 0) {
      cause_of_death = 'horizon';
    }

    // Update flow accumulators
    switch (macro.kind) {
      case 'BUY_MAX':
      case 'BUY_HALF': {
        total_buys++;
        total_spent_drugs += Math.max(0, preCash - s.cash);
        break;
      }
      case 'SELL_ALL':
      case 'SELL_HALF': {
        total_sells++;
        total_revenue_drugs += Math.max(0, s.cash - preCash);
        break;
      }
      case 'BUY_COAT': {
        total_coat_spend += Math.max(0, preCash - s.cash);
        break;
      }
      case 'PAY_DEBT_ALL': {
        total_debt_paid += Math.max(0, preDebt - s.debt);
        break;
      }
      case 'DEPOSIT_ALL': {
        total_deposited += Math.max(0, s.bank - preBank);
        break;
      }
      case 'WITHDRAW_ALL': {
        total_withdrawn += Math.max(0, preBank - s.bank);
        break;
      }
      case 'FIGHT': {
        fights_chosen++;
        hp_lost_total += Math.max(0, preHp - s.hp);
        // Loot is added to cash if we won this round
        if (preFighting && s.phase === 'playing' && s.cash > preCash) {
          loot_received_total += s.cash - preCash;
        }
        break;
      }
      case 'RUN': {
        runs_chosen++;
        hp_lost_total += Math.max(0, preHp - s.hp);
        const postInvDrugs = totalDrugUnits(s);
        drug_units_dropped += Math.max(0, preInvDrugs - postInvDrugs);
        break;
      }
      case 'ACCEPT_OFFER': {
        if (preEventOffer) {
          event_offers_accepted++;
          // gun offer: cost is the cash spent
          const spent = Math.max(0, preCash - s.cash);
          if (spent > 0) total_gun_accept_spend += spent;
        }
        break;
      }
      default: break;
    }

    const nw = netWorth(s);
    if (nw > peak_net_worth) { peak_net_worth = nw; peak_day = s.day; }

    turn++;
  }

  if (cause_of_death === 'alive' && s.phase === 'game_over') {
    cause_of_death = s.hp <= 0 ? 'cops' : 'horizon';
  }

  const alive = s.hp > 0;
  const summary: RunSummary = {
    seed, horizon: totalDays, agent: agent.name, config_hash: configHash,
    alive,
    days_played: s.day,
    turn_count: turn,
    cause_of_death,
    net_worth: netWorth(s),
    peak_net_worth, peak_day,
    total_buys, total_sells,
    total_spent_drugs, total_revenue_drugs,
    total_coat_spend, total_debt_paid,
    total_deposited, total_withdrawn,
    total_gun_accept_spend,
    final_debt: s.debt,
    final_bank: s.bank,
    final_cash: s.cash,
    final_capacity: s.capacity,
    final_guns: s.guns,
    count_by_macro: countByMacro,
    cop_encounters, fights_chosen, runs_chosen,
    hp_lost_total, drug_units_dropped, loot_received_total,
    events_total, events_by_kind: eventsByKind,
    event_offers_seen, event_offers_accepted,
  };

  return { summary, trajectory, decisions };
}

function snapshot(s: FullState, macro: string): TurnSample {
  return {
    day: s.day,
    cash: s.cash,
    bank: s.bank,
    debt: s.debt,
    inv_value: Math.round(estimateInventoryValue(s)),
    net_worth: netWorth(s),
    capacity: s.capacity,
    inv_used: inventoryUsed(s),
    hp: s.hp,
    guns: s.guns,
    loc: s.locationId,
    macro,
  };
}

function totalDrugUnits(s: FullState): number {
  let t = 0;
  for (const d of DRUGS) t += s.inv.drugs[d.id];
  return t;
}

function shouldLogDecision(s: FullState, _m: Macro): boolean {
  // Decision log entries only at interesting forks: combat, offer events.
  return s.phase === 'fighting_cops' || (s.phase === 'event' && !!s.pendingEventGenerated?.offer);
}

// ─── Experiment runner ────────────────────────────────────────────────────

export interface ExperimentConfig {
  experimentId: string;       // dir name
  agent: Agent;
  configHash?: string;
  seeds: number[];
  horizon: number;            // totalDays
  mode?: 'fixed' | 'endless';
  outDir?: string;            // default: scripts/ai/analytical/runs/<experimentId>
  telemetry?: TelemetryConfig;
}

export interface ExperimentResult {
  experimentId: string;
  outDir: string;
  summaries: RunSummary[];
  elapsedMs: number;
}

export function runExperiment(cfg: ExperimentConfig): ExperimentResult {
  const outDir = cfg.outDir ?? path.resolve('scripts/ai/analytical/runs', cfg.experimentId);
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = {
    experimentId: cfg.experimentId,
    agent: cfg.agent.name,
    configHash: cfg.configHash ?? '',
    horizon: cfg.horizon,
    mode: cfg.mode ?? 'fixed',
    seeds: cfg.seeds,
    n: cfg.seeds.length,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const summariesPath = path.join(outDir, 'summary.jsonl');
  const trajPath = path.join(outDir, 'trajectories.jsonl');
  const decPath = path.join(outDir, 'decisions.jsonl');

  const sumStream = fs.openSync(summariesPath, 'w');
  const trajStream = fs.openSync(trajPath, 'w');
  const decStream = fs.openSync(decPath, 'w');

  const summaries: RunSummary[] = [];
  const start = Date.now();
  for (const seed of cfg.seeds) {
    const trace = runOne(
      cfg.agent, seed, cfg.horizon, cfg.mode ?? 'fixed',
      cfg.configHash ?? '', cfg.telemetry,
    );
    summaries.push(trace.summary);
    fs.writeSync(sumStream, JSON.stringify(trace.summary) + '\n');
    fs.writeSync(trajStream, JSON.stringify({ seed, samples: trace.trajectory }) + '\n');
    fs.writeSync(decStream, JSON.stringify({ seed, log: trace.decisions }) + '\n');
  }
  fs.closeSync(sumStream);
  fs.closeSync(trajStream);
  fs.closeSync(decStream);

  const elapsedMs = Date.now() - start;
  return { experimentId: cfg.experimentId, outDir, summaries, elapsedMs };
}

// ─── CLI smoke test (against existing greedy agent) ───────────────────────

function isMain() {
  const argv1 = process.argv[1]?.replace(/\\/g, '/');
  const url = import.meta.url.replace(/\\/g, '/');
  return argv1 && (url.endsWith(argv1) || url === `file:///${argv1}` || url === `file://${argv1}`);
}

if (isMain()) {
  const { greedyAgent } = await import('../agents');
  const seeds = Array.from({ length: 50 }, (_, i) => 1000 + i);
  console.log('Running telemetry smoke test: GREEDY × 50 seeds × 30D...');
  const result = runExperiment({
    experimentId: `smoke-greedy-30D-${Date.now()}`,
    agent: greedyAgent(),
    seeds,
    horizon: 30,
  });
  const nws = result.summaries.map(s => s.net_worth).sort((a, b) => a - b);
  const mean = nws.reduce((a, b) => a + b, 0) / nws.length;
  const med = nws[Math.floor(nws.length / 2)];
  const p95 = nws[Math.floor(nws.length * 0.95)];
  const deaths = result.summaries.filter(s => !s.alive).length;
  console.log(`Done in ${(result.elapsedMs / 1000).toFixed(1)}s. Output: ${result.outDir}`);
  console.log(`  mean=$${Math.round(mean).toLocaleString()} med=$${Math.round(med).toLocaleString()} p95=$${Math.round(p95).toLocaleString()} deaths=${deaths}/${nws.length}`);
}
