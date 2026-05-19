// AlphaZero-style agent: MCTS with PUCT selection, neural-network priors,
// and a learned value head replacing greedy rollouts at leaves.
//
//   PUCT score:  Q(s,a) + c_puct · π_NN(a|s) · √N(s) / (1 + N(s,a))
//   Leaf value:  V_NN(s)  (tanh-bounded)
//   Action mix:  during data collection, mix root priors with Dirichlet noise
//                for exploration; during eval, use raw priors.
//
// Returns from `chooseWithStats` provide the MCTS visit distribution at the
// root — this is the policy target for training.

import { type FullState, step, isTerminal } from './sim.ts';
import { netWorth } from '../../src/game/state.ts';
import { type Macro, legalActions, apply } from './actions.ts';
import { macroToIndex, legalMask, NUM_MACROS } from './macros.ts';
import { featurize } from './features.ts';
import { type Agent } from './agents.ts';
import { type Net, forward, maskedSoftmax } from './nn.ts';

function applyMacro(s: FullState, m: Macro): FullState {
  let cur = s;
  for (const a of apply(s, m)) cur = step(cur, a);
  return cur;
}

function macroKey(m: Macro): string {
  return m.kind + ('drug' in m ? `:${m.drug}` : 'locationId' in m ? `:${m.locationId}` : '');
}

interface Node {
  state: FullState;
  legal: Macro[];
  priors: Float32Array | null;        // network priors over NUM_MACROS, masked
  visits: number;
  totalValue: number;
  children: Map<string, Node> | null; // null until expanded
  childActions: Map<string, Macro>;
  edgeVisits: Map<string, number>;
  edgeValue: Map<string, number>;
}

function valueOf(s: FullState): number {
  return Math.tanh(netWorth(s) / 30_000);
}

function makeNode(s: FullState): Node {
  return {
    state: s,
    legal: legalActions(s),
    priors: null,
    visits: 0,
    totalValue: 0,
    children: null,
    childActions: new Map(),
    edgeVisits: new Map(),
    edgeValue: new Map(),
  };
}

function dirichlet(alpha: number, n: number, rng: () => number): Float32Array {
  // Sample Dirichlet by sampling Gamma(α,1) then normalizing.
  // Marsaglia–Tsang gamma; for small α this is approximate but fine for noise.
  const x = new Float32Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    // simple gamma via inverse-transform on exp distribution + acceptance
    // for small α: sample U^(1/α) * Exp(1) is roughly Gamma(α,1)
    const u = Math.max(1e-9, rng());
    const e = -Math.log(Math.max(1e-9, rng()));
    x[i] = Math.pow(u, 1 / alpha) * e;
    s += x[i];
  }
  if (s > 0) for (let i = 0; i < n; i++) x[i] /= s;
  else for (let i = 0; i < n; i++) x[i] = 1 / n;
  return x;
}

export interface AzCfg {
  simulations: number;
  cPuct: number;
  dirichletAlpha: number;
  dirichletEps: number;  // 0 in eval, ~0.25 during data-collection
  temperature: number;   // softmax temperature on visit counts for action selection
}

export const DEFAULT_AZ: AzCfg = {
  simulations: 200,
  cPuct: 2.0,
  dirichletAlpha: 0.3,
  dirichletEps: 0,
  temperature: 0,        // 0 = argmax visits (deterministic / strongest)
};

// Network evaluation: returns priors masked over legal moves + scalar value
function evalNet(net: Net, s: FullState, legal: Macro[]): { priors: Float32Array; value: number } {
  const x = featurize(s);
  const fw = forward(net, x);
  const mask = legalMask(legal);
  const priors = maskedSoftmax(fw.zLogits, mask);
  return { priors, value: fw.v };
}

/** Run MCTS from `root` for `simulations` iterations. Returns the root node
 *  with visit counts populated. */
function search(net: Net, root: FullState, cfg: AzCfg, rng: () => number): Node {
  const rn = makeNode(root);
  if (rn.legal.length === 0) return rn;

  // Initial expansion of root
  const rEval = evalNet(net, root, rn.legal);
  rn.priors = rEval.priors;
  rn.children = new Map();
  for (const m of rn.legal) {
    const k = macroKey(m);
    rn.childActions.set(k, m);
    rn.edgeVisits.set(k, 0);
    rn.edgeValue.set(k, 0);
  }

  // Mix Dirichlet noise into root priors (data-collection only)
  if (cfg.dirichletEps > 0) {
    const noise = dirichlet(cfg.dirichletAlpha, rn.legal.length, rng);
    let idx = 0;
    const newP = new Float32Array(NUM_MACROS);
    for (const m of rn.legal) {
      const i = macroToIndex(m);
      newP[i] = (1 - cfg.dirichletEps) * rn.priors[i] + cfg.dirichletEps * noise[idx++];
    }
    rn.priors = newP;
  }

  for (let sim = 0; sim < cfg.simulations; sim++) {
    // Selection: walk tree via PUCT until we hit a leaf
    const path: { node: Node; childKey: string }[] = [];
    let node = rn;
    while (true) {
      if (isTerminal(node.state) || node.legal.length === 0) break;
      // PUCT: pick best edge
      const sqrtN = Math.sqrt(Math.max(1, node.visits));
      let bestKey = '';
      let bestScore = -Infinity;
      for (const m of node.legal) {
        const k = macroKey(m);
        const nVisit = node.edgeVisits.get(k) ?? 0;
        const qSum = node.edgeValue.get(k) ?? 0;
        const Q = nVisit > 0 ? qSum / nVisit : 0;
        const P = node.priors![macroToIndex(m)];
        const U = cfg.cPuct * P * sqrtN / (1 + nVisit);
        const score = Q + U;
        if (score > bestScore) { bestScore = score; bestKey = k; }
      }
      path.push({ node, childKey: bestKey });
      let child = node.children!.get(bestKey);
      if (!child) {
        // Create child lazily — apply action to get next state
        const macro = node.childActions.get(bestKey)!;
        child = makeNode(applyMacro(node.state, macro));
        node.children!.set(bestKey, child);
      }
      node = child;
      // If we just expanded this child for the first time, stop here for eval
      if (node.priors === null) break;
    }

    // Evaluation: get leaf value
    let v: number;
    if (isTerminal(node.state)) {
      v = valueOf(node.state);
    } else if (node.legal.length === 0) {
      v = valueOf(node.state);
    } else if (node.priors === null) {
      // First visit — expand with NN
      const ev = evalNet(net, node.state, node.legal);
      node.priors = ev.priors;
      node.children = new Map();
      for (const m of node.legal) {
        const k = macroKey(m);
        node.childActions.set(k, m);
        node.edgeVisits.set(k, 0);
        node.edgeValue.set(k, 0);
      }
      v = ev.value;
    } else {
      // Shouldn't reach here, but if it does just use a quick estimate
      v = valueOf(node.state);
    }

    // Backup: increment visits and value along the path
    node.visits++;
    node.totalValue += v;
    for (const step of path) {
      step.node.visits++;
      step.node.totalValue += v;
      step.node.edgeVisits.set(step.childKey, (step.node.edgeVisits.get(step.childKey) ?? 0) + 1);
      step.node.edgeValue.set(step.childKey, (step.node.edgeValue.get(step.childKey) ?? 0) + v);
    }
  }
  return rn;
}

/** Choose the strongest action at the root according to MCTS visit counts. */
export function azAgent(net: Net, opts: Partial<AzCfg> = {}): Agent {
  const cfg: AzCfg = { ...DEFAULT_AZ, ...opts };
  const rng = Math.random;
  return {
    name: `AZ_${cfg.simulations}`,
    choose: (state) => {
      if (state.phase === 'game_over') return null;
      const root = search(net, state, cfg, rng);
      if (root.legal.length === 0) return null;
      let bestKey = '';
      let bestVisits = -1;
      for (const m of root.legal) {
        const k = macroKey(m);
        const n = root.edgeVisits.get(k) ?? 0;
        if (n > bestVisits) { bestVisits = n; bestKey = k; }
      }
      return root.childActions.get(bestKey) ?? root.legal[0];
    },
  };
}

/** Search-and-return-distribution variant used during self-play data collection.
 *  Returns:
 *    - chosen macro (sampled from visit distribution, possibly with temperature)
 *    - π_visit: visit-distribution as full NUM_MACROS array (legal slots only)
 *    - mask: legal-action mask
 *    - value estimate at root (for advantage tracking, optional)
 */
export function azSelfplayMove(
  net: Net,
  state: FullState,
  cfg: AzCfg,
): { macro: Macro; pi: Float32Array; mask: Float32Array; rootValue: number } | null {
  if (state.phase === 'game_over') return null;
  const root = search(net, state, cfg, Math.random);
  if (root.legal.length === 0) return null;

  const mask = legalMask(root.legal);
  const pi = new Float32Array(NUM_MACROS);
  let totalVisits = 0;
  for (const m of root.legal) {
    const k = macroKey(m);
    totalVisits += root.edgeVisits.get(k) ?? 0;
  }
  if (totalVisits > 0) {
    for (const m of root.legal) {
      const k = macroKey(m);
      const idx = macroToIndex(m);
      pi[idx] = (root.edgeVisits.get(k) ?? 0) / totalVisits;
    }
  } else {
    // Fallback: uniform over legal
    const inv = 1 / root.legal.length;
    for (const m of root.legal) pi[macroToIndex(m)] = inv;
  }

  // Sample action — temperature 0 = argmax, T > 0 = softmax over visits
  let chosen: Macro;
  if (cfg.temperature <= 0) {
    let best = -1, bestKey = '';
    for (const m of root.legal) {
      const k = macroKey(m);
      const n = root.edgeVisits.get(k) ?? 0;
      if (n > best) { best = n; bestKey = k; }
    }
    chosen = root.childActions.get(bestKey) ?? root.legal[0];
  } else {
    // Sample proportionally to visits^(1/T)
    const T = cfg.temperature;
    const weights = root.legal.map(m => Math.pow((root.edgeVisits.get(macroKey(m)) ?? 0) + 1e-6, 1 / T));
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;
    let idx = 0;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) { idx = i; break; }
    }
    chosen = root.legal[idx];
  }

  const rootValue = root.visits > 0 ? root.totalValue / root.visits : 0;
  return { macro: chosen, pi, mask, rootValue };
}
