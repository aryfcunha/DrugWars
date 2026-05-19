// Pure-JS dual-head MLP (no TensorFlow.js dependency).
//
//   input (FEATURE_DIM)
//     → Linear(hidden) → ReLU
//     → { policy head: Linear(NUM_MACROS)  → masked softmax
//         value  head: Linear(1)           → tanh }
//
// Total params at hidden=64: 34*64 + 64*39 + 64*1 + 64+39+1 = 4,729. Tiny.
//
// Training: Adam optimizer, manual backprop. Combined loss:
//   L = α · KL(π_target ‖ softmax(masked_logits)) + β · (v_target - v_pred)²
//
// The MCTS visit distribution serves as π_target; the final-game return
// (squashed via tanh(nw/30k)) serves as v_target.

import { FEATURE_DIM } from './features.ts';
import { NUM_MACROS } from './macros.ts';
import { readFileSync, writeFileSync } from 'node:fs';

const SQRT2 = Math.sqrt(2);

function randn(): number {
  // Box-Muller
  const u = Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u || 1e-9)) * Math.cos(2 * Math.PI * v);
}

function he(arr: Float32Array, fanIn: number) {
  // He initialization (good for ReLU): scale = sqrt(2/fan_in)
  const s = Math.sqrt(2 / fanIn);
  for (let i = 0; i < arr.length; i++) arr[i] = randn() * s;
}

// ────────────────────────────────────────────────────────────────────────────
// Network state
// ────────────────────────────────────────────────────────────────────────────

export interface Net {
  inDim: number;
  hidden: number;
  outPolicy: number;
  // Layer 1: in -> hidden
  W1: Float32Array;  // [hidden, in]
  b1: Float32Array;  // [hidden]
  // Policy head: hidden -> outPolicy
  Wp: Float32Array;  // [outPolicy, hidden]
  bp: Float32Array;  // [outPolicy]
  // Value head: hidden -> 1
  Wv: Float32Array;  // [1, hidden]
  bv: Float32Array;  // [1]
  // Adam optimizer state (moments)
  m: { W1: Float32Array; b1: Float32Array; Wp: Float32Array; bp: Float32Array; Wv: Float32Array; bv: Float32Array };
  v: { W1: Float32Array; b1: Float32Array; Wp: Float32Array; bp: Float32Array; Wv: Float32Array; bv: Float32Array };
  t: number;
}

export function makeNet(hidden = 64): Net {
  const inDim = FEATURE_DIM;
  const outPolicy = NUM_MACROS;
  const zeros = (n: number) => new Float32Array(n);
  const n: Net = {
    inDim, hidden, outPolicy,
    W1: new Float32Array(hidden * inDim), b1: zeros(hidden),
    Wp: new Float32Array(outPolicy * hidden), bp: zeros(outPolicy),
    Wv: new Float32Array(1 * hidden), bv: zeros(1),
    m: {
      W1: zeros(hidden * inDim), b1: zeros(hidden),
      Wp: zeros(outPolicy * hidden), bp: zeros(outPolicy),
      Wv: zeros(hidden), bv: zeros(1),
    },
    v: {
      W1: zeros(hidden * inDim), b1: zeros(hidden),
      Wp: zeros(outPolicy * hidden), bp: zeros(outPolicy),
      Wv: zeros(hidden), bv: zeros(1),
    },
    t: 0,
  };
  he(n.W1, inDim);
  he(n.Wp, hidden);
  he(n.Wv, hidden);
  // Suppress unused
  void SQRT2;
  return n;
}

// ────────────────────────────────────────────────────────────────────────────
// Forward — returns (hidden activations, policy logits, value)
// ────────────────────────────────────────────────────────────────────────────

export interface Forward {
  h: Float32Array;      // post-ReLU hidden [hidden]
  zLogits: Float32Array;// policy logits [outPolicy]
  vRaw: number;         // pre-tanh value
  v: number;            // tanh(vRaw)
}

export function forward(net: Net, x: Float32Array): Forward {
  // Layer 1: z = W1 x + b1, h = relu(z)
  const h = new Float32Array(net.hidden);
  for (let i = 0; i < net.hidden; i++) {
    let s = net.b1[i];
    const row = i * net.inDim;
    for (let j = 0; j < net.inDim; j++) s += net.W1[row + j] * x[j];
    h[i] = s > 0 ? s : 0;
  }
  // Policy logits
  const zLogits = new Float32Array(net.outPolicy);
  for (let i = 0; i < net.outPolicy; i++) {
    let s = net.bp[i];
    const row = i * net.hidden;
    for (let j = 0; j < net.hidden; j++) s += net.Wp[row + j] * h[j];
    zLogits[i] = s;
  }
  // Value
  let vRaw = net.bv[0];
  for (let j = 0; j < net.hidden; j++) vRaw += net.Wv[j] * h[j];
  const v = Math.tanh(vRaw);
  return { h, zLogits, vRaw, v };
}

/** Masked softmax: legal=0 entries get -inf logit so they're zero-prob. */
export function maskedSoftmax(logits: Float32Array, mask: Float32Array): Float32Array {
  const N = logits.length;
  let max = -Infinity;
  for (let i = 0; i < N; i++) {
    if (mask[i] === 0) continue;
    if (logits[i] > max) max = logits[i];
  }
  if (!isFinite(max)) {
    // Fallback: uniform over legal
    const out = new Float32Array(N);
    let s = 0;
    for (let i = 0; i < N; i++) s += mask[i];
    if (s > 0) for (let i = 0; i < N; i++) out[i] = mask[i] / s;
    return out;
  }
  const out = new Float32Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    if (mask[i] === 0) continue;
    out[i] = Math.exp(logits[i] - max);
    sum += out[i];
  }
  if (sum > 0) for (let i = 0; i < N; i++) out[i] /= sum;
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Backward + Adam step on a single mini-batch
// ────────────────────────────────────────────────────────────────────────────

export interface Batch {
  x: Float32Array[];          // each [FEATURE_DIM]
  piTarget: Float32Array[];   // each [NUM_MACROS], legal-only, sum=1
  mask: Float32Array[];       // each [NUM_MACROS], 0/1
  vTarget: number[];          // each in [-1,1]
}

export interface AdamCfg {
  lr: number;
  beta1: number;
  beta2: number;
  eps: number;
  valueWeight: number;        // β
  policyWeight: number;       // α
  l2: number;                 // weight decay (applied to W matrices only)
}

export const DEFAULT_ADAM: AdamCfg = {
  lr: 3e-3,
  beta1: 0.9,
  beta2: 0.999,
  eps: 1e-8,
  valueWeight: 1.0,
  policyWeight: 1.0,
  l2: 1e-5,
};

interface Grads {
  W1: Float32Array; b1: Float32Array;
  Wp: Float32Array; bp: Float32Array;
  Wv: Float32Array; bv: Float32Array;
}

function zerosGrads(net: Net): Grads {
  return {
    W1: new Float32Array(net.hidden * net.inDim),
    b1: new Float32Array(net.hidden),
    Wp: new Float32Array(net.outPolicy * net.hidden),
    bp: new Float32Array(net.outPolicy),
    Wv: new Float32Array(net.hidden),
    bv: new Float32Array(1),
  };
}

/** Accumulate gradients from one sample into g. Returns per-sample loss for logging. */
function accumGrads(net: Net, g: Grads, sample: {
  x: Float32Array; piTarget: Float32Array; mask: Float32Array; vTarget: number;
}, cfg: AdamCfg): { policyLoss: number; valueLoss: number } {
  const fw = forward(net, sample.x);
  const piPred = maskedSoftmax(fw.zLogits, sample.mask);

  // Value loss: MSE on tanh output -> dL/dvRaw = 2(v - vT) * (1 - v²)
  const dV = (fw.v - sample.vTarget);
  const valueLoss = dV * dV;
  const dVRaw = 2 * dV * (1 - fw.v * fw.v) * cfg.valueWeight;

  // Policy loss: KL/cross-entropy on softmax. ∂L/∂z_i = (p_i - q_i) for masked-softmax
  let policyLoss = 0;
  const dLogits = new Float32Array(net.outPolicy);
  for (let i = 0; i < net.outPolicy; i++) {
    if (sample.mask[i] === 0) { dLogits[i] = 0; continue; }
    if (sample.piTarget[i] > 0 && piPred[i] > 0) {
      policyLoss += -sample.piTarget[i] * Math.log(Math.max(1e-9, piPred[i]));
    }
    dLogits[i] = (piPred[i] - sample.piTarget[i]) * cfg.policyWeight;
  }

  // Backprop through value head
  // dWv += dVRaw * h, dbv += dVRaw, dh += dVRaw * Wv
  const dh = new Float32Array(net.hidden);
  for (let j = 0; j < net.hidden; j++) {
    g.Wv[j] += dVRaw * fw.h[j];
    dh[j] += dVRaw * net.Wv[j];
  }
  g.bv[0] += dVRaw;

  // Backprop through policy head
  // dWp[i,j] += dLogits[i] * h[j], dbp[i] += dLogits[i], dh[j] += sum_i dLogits[i] * Wp[i,j]
  for (let i = 0; i < net.outPolicy; i++) {
    const di = dLogits[i];
    if (di === 0) continue;
    g.bp[i] += di;
    const row = i * net.hidden;
    for (let j = 0; j < net.hidden; j++) {
      g.Wp[row + j] += di * fw.h[j];
      dh[j] += di * net.Wp[row + j];
    }
  }

  // Backprop through ReLU: dz = dh * (h > 0)
  for (let j = 0; j < net.hidden; j++) {
    if (fw.h[j] <= 0) dh[j] = 0;
  }

  // Backprop through layer 1: dW1[i,j] += dz[i] * x[j], db1[i] += dz[i]
  for (let i = 0; i < net.hidden; i++) {
    const di = dh[i];
    if (di === 0) continue;
    g.b1[i] += di;
    const row = i * net.inDim;
    for (let j = 0; j < net.inDim; j++) g.W1[row + j] += di * sample.x[j];
  }

  return { policyLoss, valueLoss };
}

function adamApply(
  param: Float32Array, grad: Float32Array,
  m: Float32Array, v: Float32Array,
  t: number, cfg: AdamCfg, l2: boolean,
) {
  const { lr, beta1, beta2, eps } = cfg;
  const bc1 = 1 - Math.pow(beta1, t);
  const bc2 = 1 - Math.pow(beta2, t);
  for (let i = 0; i < param.length; i++) {
    let gi = grad[i];
    if (l2) gi += cfg.l2 * param[i];
    m[i] = beta1 * m[i] + (1 - beta1) * gi;
    v[i] = beta2 * v[i] + (1 - beta2) * gi * gi;
    const mh = m[i] / bc1;
    const vh = v[i] / bc2;
    param[i] -= lr * mh / (Math.sqrt(vh) + eps);
  }
}

export function trainStep(net: Net, batch: Batch, cfg: AdamCfg = DEFAULT_ADAM): { policyLoss: number; valueLoss: number } {
  const g = zerosGrads(net);
  let pSum = 0, vSum = 0;
  for (let i = 0; i < batch.x.length; i++) {
    const loss = accumGrads(net, g, {
      x: batch.x[i], piTarget: batch.piTarget[i],
      mask: batch.mask[i], vTarget: batch.vTarget[i],
    }, cfg);
    pSum += loss.policyLoss;
    vSum += loss.valueLoss;
  }
  // Average over batch
  const N = batch.x.length;
  for (const k of ['W1','b1','Wp','bp','Wv','bv'] as const) {
    const gg = g[k];
    for (let i = 0; i < gg.length; i++) gg[i] /= N;
  }
  net.t++;
  adamApply(net.W1, g.W1, net.m.W1, net.v.W1, net.t, cfg, true);
  adamApply(net.b1, g.b1, net.m.b1, net.v.b1, net.t, cfg, false);
  adamApply(net.Wp, g.Wp, net.m.Wp, net.v.Wp, net.t, cfg, true);
  adamApply(net.bp, g.bp, net.m.bp, net.v.bp, net.t, cfg, false);
  adamApply(net.Wv, g.Wv, net.m.Wv, net.v.Wv, net.t, cfg, true);
  adamApply(net.bv, g.bv, net.m.bv, net.v.bv, net.t, cfg, false);
  return { policyLoss: pSum / N, valueLoss: vSum / N };
}

// ────────────────────────────────────────────────────────────────────────────
// Persistence (JSON; small networks)
// ────────────────────────────────────────────────────────────────────────────

export function saveNet(net: Net, path: string): void {
  const arr = (a: Float32Array) => Array.from(a);
  const payload = {
    inDim: net.inDim, hidden: net.hidden, outPolicy: net.outPolicy, t: net.t,
    W1: arr(net.W1), b1: arr(net.b1),
    Wp: arr(net.Wp), bp: arr(net.bp),
    Wv: arr(net.Wv), bv: arr(net.bv),
  };
  writeFileSync(path, JSON.stringify(payload));
}

export function loadNet(path: string): Net {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const n = makeNet(j.hidden);
  if (j.inDim !== n.inDim || j.outPolicy !== n.outPolicy) {
    throw new Error(`Net shape mismatch: file has in=${j.inDim} out=${j.outPolicy}, code has ${n.inDim}/${n.outPolicy}`);
  }
  n.W1.set(j.W1); n.b1.set(j.b1);
  n.Wp.set(j.Wp); n.bp.set(j.bp);
  n.Wv.set(j.Wv); n.bv.set(j.bv);
  n.t = j.t ?? 0;
  return n;
}
