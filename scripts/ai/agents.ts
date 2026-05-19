// Agents: Random, Greedy, MCTS.
//
// Agent interface = a function that, given a state, returns the chosen Macro.
// Each agent may carry its own state (e.g., RNG, tree cache) — we capture it
// via closure.

import { type FullState, step } from './sim.ts';
import { netWorth } from '../../src/game/state.ts';
import { type Macro, legalActions, apply } from './actions.ts';
import { DRUGS, type DrugId } from '../../src/game/data.ts';
import { mulberry32 } from '../../src/game/rng.ts';

export interface Agent {
  name: string;
  choose: (s: FullState) => Macro | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function applyMacro(s: FullState, m: Macro): FullState {
  const acts = apply(s, m);
  let cur = s;
  for (const a of acts) cur = step(cur, a);
  return cur;
}

// ────────────────────────────────────────────────────────────────────────────
// Random agent
// ────────────────────────────────────────────────────────────────────────────

export function randomAgent(seed: number): Agent {
  const rng = mulberry32(seed);
  return {
    name: 'RANDOM',
    choose: (s) => {
      const actions = legalActions(s);
      return actions.length ? actions[Math.floor(rng() * actions.length)] : null;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Greedy heuristic agent — also used as the MCTS rollout policy.
//
// Heuristic rules, in priority order:
//   1. If in cop fight: FIGHT if guns + hp > 50, else RUN.
//   2. If offered a gun: ACCEPT if cash > 1.5× cost.
//   3. SELL drugs whose price is in the top quartile of their range.
//   4. BUY the drug with the lowest priceRatio = price/min in the market,
//      provided ratio < 0.55 (significantly below mid-range).
//   5. At Bronx with cash > debt: PAY_DEBT.
//   6. At Bronx with debt high but cash modest: ignore banking.
//   7. TRAVEL: prefer location with lowest copRisk that we haven't been at
//      this turn (avoid bouncing between same two locations).
// ────────────────────────────────────────────────────────────────────────────

const DRUG_MID: Record<DrugId, number> = Object.fromEntries(
  DRUGS.map(d => [d.id, (d.min + d.max) / 2]),
) as Record<DrugId, number>;

const DRUG_HIGH: Record<DrugId, number> = Object.fromEntries(
  DRUGS.map(d => [d.id, d.min + 0.7 * (d.max - d.min)]),
) as Record<DrugId, number>;

const DRUG_LOW: Record<DrugId, number> = Object.fromEntries(
  DRUGS.map(d => [d.id, d.min + 0.30 * (d.max - d.min)]),
) as Record<DrugId, number>;

export function greedyChoose(s: FullState): Macro | null {
  const actions = legalActions(s);
  if (!actions.length) return null;

  // 1. Cop fight
  if (s.phase === 'fighting_cops') {
    if (s.guns >= 2 && s.hp > 60) return { kind: 'FIGHT' };
    return { kind: 'RUN' };
  }

  // 2. Offer (gun for sale)
  if (s.phase === 'event' && s.pendingEventGenerated?.offer) {
    const cost = -(s.pendingEventGenerated.offer.accept.cashDelta ?? 0);
    if (s.guns === 0 && s.cash > cost * 2) return { kind: 'ACCEPT_OFFER' };
    return { kind: 'DECLINE_OFFER' };
  }

  // 3. SELL drugs at high prices (priority over buying so we free space)
  for (const drug of DRUGS) {
    const price = s.market.prices[drug.id];
    const have = s.inv.drugs[drug.id];
    if (price != null && have > 0 && price >= DRUG_HIGH[drug.id]) {
      return { kind: 'SELL_ALL', drug: drug.id };
    }
  }

  // 4. BUY cheap drugs
  let bestDrug: DrugId | null = null;
  let bestRatio = Infinity;
  for (const drug of DRUGS) {
    const price = s.market.prices[drug.id];
    if (price == null) continue;
    if (price > DRUG_LOW[drug.id]) continue;          // not cheap enough
    const ratio = price / DRUG_MID[drug.id];
    if (ratio < bestRatio) {
      bestRatio = ratio;
      bestDrug = drug.id;
    }
  }
  if (bestDrug) {
    // Only buy if it's actually affordable and we have space
    const haveBuyMax = actions.some(a => a.kind === 'BUY_MAX' && a.drug === bestDrug);
    if (haveBuyMax) return { kind: 'BUY_MAX', drug: bestDrug };
  }

  // 5. Bronx banking
  if (s.locationId === 'bronx') {
    if (s.cash > s.debt && s.debt > 0) return { kind: 'PAY_DEBT_ALL' };
    if (s.debt === 0 && s.cash > 5000) return { kind: 'DEPOSIT_ALL' };
  }

  // 6. Buy coat opportunistically when we have lots of cash and inventory is tight
  if (s.cash > 5000) {
    const free = s.capacity - Object.values(s.inv.drugs).reduce((a, b) => a + b, 0) - s.guns * 5;
    if (free < 10 && actions.some(a => a.kind === 'BUY_COAT')) return { kind: 'BUY_COAT' };
  }

  // 7. Travel — pick a low-cop-risk place we're not at. Prefer Bronx if debt high.
  const travels = actions.filter(a => a.kind === 'TRAVEL') as Extract<Macro, { kind: 'TRAVEL' }>[];
  if (travels.length) {
    if (s.debt > 5000 && s.cash > 2000) {
      const bronx = travels.find(t => t.locationId === 'bronx');
      if (bronx) return bronx;
    }
    // Otherwise: prefer coney (lowest cop risk), then central
    const priority = ['coney', 'central', 'brooklyn', 'bronx', 'manhattan', 'ghetto'];
    for (const id of priority) {
      const t = travels.find(t => t.locationId === id);
      if (t) return t;
    }
    return travels[0];
  }

  // Fallback: pick first legal
  return actions[0];
}

export function greedyAgent(): Agent {
  return { name: 'GREEDY', choose: greedyChoose };
}

// ────────────────────────────────────────────────────────────────────────────
// MCTS agent with greedy rollouts
//
// Standard UCB1: a* = argmax_a [Q(s,a) + c · sqrt(ln N(s) / N(s,a))]
// Leaf evaluation: run a greedy rollout to end-of-game (or maxRollDepth), return
//   the final net-worth (scaled / sigmoid'd).
// Tree is rebuilt every turn (no persistence across moves) — Drug Wars's
// stochasticity makes tree reuse low-value anyway.
// ────────────────────────────────────────────────────────────────────────────

interface Node {
  state: FullState;
  visits: number;
  totalValue: number;
  children: Map<string, Node> | null; // key = macroKey, null = unexpanded
  legal: Macro[];
}

function macroKey(m: Macro): string {
  return m.kind + ('drug' in m ? `:${m.drug}` : 'locationId' in m ? `:${m.locationId}` : '');
}

function makeNode(s: FullState): Node {
  return { state: s, visits: 0, totalValue: 0, children: null, legal: legalActions(s) };
}

/** Squash net-worth into roughly [-1, 1] so UCB exploration constant is sane. */
function valueOf(s: FullState): number {
  const nw = netWorth(s);
  // Tanh-ish: $50k → ~0.83, $0 → 0, -$10k → ~-0.46
  return Math.tanh(nw / 30_000);
}

function rolloutGreedy(s: FullState, maxSteps: number): number {
  let cur = s;
  for (let i = 0; i < maxSteps; i++) {
    if (cur.phase === 'game_over') break;
    const m = greedyChoose(cur);
    if (!m) break;
    cur = applyMacro(cur, m);
  }
  return valueOf(cur);
}

function ucbSelect(node: Node, c: number): [string, Node] {
  const logN = Math.log(Math.max(1, node.visits));
  let bestKey = '';
  let bestChild: Node | null = null;
  let bestScore = -Infinity;
  for (const [k, child] of node.children!) {
    const exploit = child.visits === 0 ? 0 : child.totalValue / child.visits;
    const explore = c * Math.sqrt(logN / Math.max(1, child.visits));
    const score = child.visits === 0 ? Infinity : exploit + explore;
    if (score > bestScore) { bestScore = score; bestKey = k; bestChild = child; }
  }
  return [bestKey, bestChild!];
}

export interface MctsOptions {
  simulations: number;       // tree expansions per decision
  ucbC: number;              // exploration constant
  rolloutDepth: number;      // max steps in a greedy rollout
}

export function mctsAgent(opts: Partial<MctsOptions> = {}): Agent {
  const cfg: MctsOptions = {
    simulations: opts.simulations ?? 1500,
    ucbC: opts.ucbC ?? 1.4,
    rolloutDepth: opts.rolloutDepth ?? 200,
  };
  return {
    name: `MCTS_${cfg.simulations}`,
    choose: (root) => {
      const legal = legalActions(root);
      if (legal.length === 0) return null;
      if (legal.length === 1) return legal[0];

      const rootNode = makeNode(root);
      rootNode.children = new Map();
      for (const m of legal) {
        const child = makeNode(applyMacro(root, m));
        rootNode.children.set(macroKey(m), child);
      }

      for (let i = 0; i < cfg.simulations; i++) {
        // 1. Select: walk tree via UCB until we hit an unexpanded or terminal node
        const path: Node[] = [rootNode];
        let node = rootNode;
        while (node.children && node.legal.length > 0 && node.state.phase !== 'game_over') {
          const [, child] = ucbSelect(node, cfg.ucbC);
          path.push(child);
          node = child;
          // If this child has never been expanded, stop here and expand it next
          if (!node.children) break;
        }
        // 2. Expand: if non-terminal and unexpanded, expand
        if (!node.children && node.state.phase !== 'game_over' && node.legal.length > 0) {
          node.children = new Map();
          for (const m of node.legal) {
            const child = makeNode(applyMacro(node.state, m));
            node.children.set(macroKey(m), child);
          }
        }
        // 3. Simulate: greedy rollout from leaf
        const v = node.state.phase === 'game_over'
          ? valueOf(node.state)
          : rolloutGreedy(node.state, cfg.rolloutDepth);
        // 4. Backpropagate
        for (const n of path) { n.visits++; n.totalValue += v; }
      }

      // Pick the most-visited (robust) action
      let bestKey = '';
      let bestVisits = -1;
      for (const [k, child] of rootNode.children!) {
        if (child.visits > bestVisits) { bestVisits = child.visits; bestKey = k; }
      }
      return legal.find(m => macroKey(m) === bestKey) ?? legal[0];
    },
  };
}
