# Drug Wars AI

Self-play AI for Drug Wars. **v1** = pure MCTS with greedy rollouts. **v2** =
AlphaZero-style: neural-network priors guide PUCT, learned value head replaces
rollouts. Both are pure TypeScript/Node — no Python, no TensorFlow.js — and
import the game's reducer directly for ground-truth telemetry.

## Quick start

```bash
# v1: benchmark hand-rolled agents at a single horizon
npm run ai:eval -- --days 30 --n 30

# v1: single agent, custom MCTS budget
npm run ai:eval -- --days 60 --n 10 --agent mcts --sims 3000

# v1: quick curriculum pipeline validation (~5 min)
npm run ai:train -- --quick

# v1: full curriculum (3D → 90D → endless; ~1-2 hours)
npm run ai:train

# v1: full curriculum + submit best per rung to leaderboard
# (requires .env.local with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
npm run ai:train:submit

# v2: train an AlphaZero agent at a given horizon
npm run ai:az -- --days 3 --iters 6 --games 20 --sims 120 --eval-n 20 --eval-sims 120
npm run ai:az -- --days 5 --iters 8 --games 25 --sims 200 --epochs 4 --eval-sims 200

# v2: evaluate a trained network
npm run ai:eval -- --days 3 --n 30 --agent az --sims 200 \
  --net scripts/ai/runs/az-net-3D-<timestamp>.json
```

## Architecture

| File             | Role |
|------------------|------|
| `sim.ts`         | Headless wrapper around `src/game/reducer.ts`. Auto-resolves trivial event modals so the agent only sees actual decision points. |
| `actions.ts`     | Discretized action space: `BUY_MAX`/`BUY_HALF`/`SELL_ALL`/`SELL_HALF` per drug, `TRAVEL_*`, `BUY_COAT`, `PAY_DEBT_ALL`, `DEPOSIT_ALL`, `WITHDRAW_ALL`, `FIGHT`/`RUN`, `ACCEPT_OFFER`/`DECLINE_OFFER`, `RETIRE`. |
| `macros.ts`      | **v2.** Fixed action-index map (39 slots) for the policy head. `legalMask()` produces a 0/1 vector for masking softmax. |
| `features.ts`    | **v2.** State → 34-dim flat feature vector. Log-scaled monetary fields; price/midpoint ratios; one-hot location; combat/event flags; signed tanh of net worth. |
| `nn.ts`          | **v2.** Pure-JS dual-head MLP (no TensorFlow.js dep). 34→64 ReLU → {policy 39 logits, value scalar tanh}. ~4700 params total. Adam optimizer, masked softmax, KL+MSE combined loss, save/load JSON. |
| `agents.ts`      | v1 agents: `RANDOM`, `GREEDY` (hand-crafted heuristic), `MCTS` (UCB1 + greedy rollouts). |
| `agent_az.ts`    | **v2.** PUCT MCTS with neural-network priors and value head. Dirichlet noise at root during data collection. Returns visit distribution for training. |
| `iterate.ts`     | **v2.** AlphaZero outer loop: alternate self-play (with NN-guided MCTS) and SGD training on (state, π_visit, mask, return) tuples. |
| `eval.ts`        | Benchmark harness — runs N seeds, reports mean / median / p95 / min / max net worth. |
| `curriculum.ts`  | 8-rung curriculum from 3D → 90D → endless. Each rung: baseline (greedy) vs current MCTS, log to `runs/*.jsonl`, optionally submit best to Supabase. |
| `submit.ts`      | Supabase client. Reads `.env.local`. Versioned names: `AI_MCTS_v1`, `AI_AZ_v2`, etc. (16-char cap). |
| `cli.ts`         | Entry point. `npm run ai:eval -- ...` / `npm run ai:train -- ...` / `npm run ai:az -- ...` |

## Algorithm

The game is stochastic (random events, market prices, cop fights), so true
AlphaZero (deterministic-env MCTS + NN) doesn't apply directly. Hybrid approach
(per Splendor MuZero research findings):

### v1 — MCTS + greedy rollouts (no learning)

1. **MCTS with UCB1 selection.** `argmax_a Q(s,a) + c·sqrt(ln N(s)/N(s,a))`,
   `c=1.4`.
2. **Greedy rollouts** at leaves — far lower variance than random rollouts on
   long horizons.
3. **Value squashing.** `tanh(nw / 30_000)` keeps the UCB constant
   well-scaled regardless of game length.
4. **Tree rebuilt per turn** — high stochasticity makes cached subtrees low
   value.

### v2 — AlphaZero (hybrid MCTS + learned policy/value)

Builds on v1 by replacing the two weakest pieces (uniform priors, greedy
rollouts at leaves) with a learned dual-head network.

1. **PUCT selection** instead of UCB1:
   `Q(s,a) + c_puct · π_NN(a|s) · √N(s) / (1 + N(s,a))`,  `c_puct = 2.0`.
2. **Neural-network priors.** `π_NN(·|s) = softmax_legal(policy_head(s))`.
   Masked softmax: illegal-action logits get `−∞` before softmax, so the
   probability mass is redistributed across legal actions only.
3. **NN value at leaves** — no more rollouts. `V_NN(s) = tanh(value_head(s))`.
4. **Dirichlet exploration at root** (training only): mix
   `π_NN` with Dirichlet(α=0.3) noise weighted ε=0.25.
5. **Outer loop** (`iterate.ts`):
   1. Self-play `G` games with current net; collect `(state_features, π_visit,
      legal_mask, final_return)` at every turn.
   2. SGD training: minibatch over the buffer.
   3. Eval against fixed seed set; save checkpoint.

### Network spec

```
input  : 34 dims (features.ts)
linear : 34 → 64,   ReLU
policy : 64 → 39,   masked softmax  (39 = action index size)
value  : 64 → 1,    tanh
```

~4,700 parameters total. Forward + backward in pure JS, ~0.1 ms per sample.

### Loss

```
L = α · KL(π_visit ‖ π_NN_masked) + β · (v_target − v_NN)²
```

with `α = β = 1`, plus weight decay `1e-5` on W matrices, optimized via Adam
(`lr=3e-3`, `β1=0.9`, `β2=0.999`). Targets:

- `π_visit[i] = N(root→action_i) / Σ N(root→·)` (MCTS visit distribution)
- `v_target  = tanh(final_net_worth / 30_000)`

### Curriculum

Rungs are easier (short) → harder (long) so the agent's MCTS budget scales
with horizon. Earlier rungs validate the action space and reward signal;
longer rungs stress the rollout policy's quality.

| Rung | Days | Episodes | Sims/turn | Time (est.) |
|------|------|----------|-----------|-------------|
| 0    | 3    | 30       | 800       | ~10 s       |
| 1    | 5    | 25       | 900       | ~25 s       |
| 2    | 10   | 20       | 1100      | ~12 min     |
| 3    | 15   | 15       | 1200      | ~20 min     |
| 4    | 30   | 10       | 1400      | ~30 min     |
| 5    | 60   | 6        | 1600      | ~45 min     |
| 6    | 90   | 4        | 1800      | ~60 min     |
| 7    | ∞    | 4        | 1600      | varies      |

> **Observed results (v1, partial run):**
> | Rung | Greedy mean | MCTS mean   | MCTS best |
> |------|-------------|-------------|-----------|
> | 3D   | $-6,756     | $-3,593     | $22,930   |
> | 5D   | $-7,176     | $-2,971     | $12,989   |
> | 10D  | $-7,993     | **$+681**   | **$85,547** |

### Submission naming

Versioned via `AI_VERSION` env var (default `1`):

- `AI_MCTS_v1`   — top MCTS net worth at this rung
- `AI_GREEDY_v1` — baseline (same seed set)

Each rung submits one entry per agent to its days-bucket on the leaderboard.
Iterate by bumping `AI_VERSION=2` etc.

```bash
AI_VERSION=2 npm run ai:train:submit
```

## Roadmap

- [x] Headless simulator + discretized actions
- [x] Random / Greedy / MCTS agents
- [x] Eval harness + curriculum runner
- [x] Supabase leaderboard submission
- [x] **v2 — AlphaZero loop:** features.ts (state→34-dim), macros.ts (39-slot
      action index), nn.ts (pure-JS dual-head MLP w/ Adam), agent_az.ts (PUCT
      MCTS w/ priors), iterate.ts (self-play → train → eval cycle).
- [ ] **Curriculum integration for v2:** train at 3D, transfer to 5D, etc.;
      submit each rung's best as `AI_AZ_v2`/`v3`/...
- [ ] **Better policy convergence:** policy loss plateaus around 2.0 on 3D
      (vs ~1.6 uniform-over-7-legal). Try lower lr, more games per iter,
      gradient clipping.
- [ ] **Parallel self-play** — Worker threads for 4× throughput.
- [ ] **Symmetry augmentation** — if any drug-permutation symmetry holds
      (most don't due to paraquat/find_drugs asymmetry), exploit for free
      data. Splendor MuZero gets 120× from color permutations.

## v2 validation snapshot (3-day rung)

Run: `npm run ai:az -- --days 3 --iters 6 --games 20 --sims 120`

| Iteration | AZ mean | policyL | valueL |
|-----------|---------|---------|--------|
| 1         | $-4,880 | 1.89    | 0.005  |
| 4         | $-4,682 | 2.03    | 0.0003 |
| 6         | $-4,841 | 2.07    | 0.0003 |

Baselines (same seeds): Greedy mean $-6,110, MCTS@360sims mean $-3,520.

AZ beats Greedy by ~$1,400 consistently after 1 iteration; MCTS at 3× the
compute budget still wins. Value head converges in 1 iteration; policy head
needs hyperparameter tuning to push below 2.0.

## Tunables

- `agents.ts:valueOf` — change the reward squashing (`tanh(nw/30k)`).
- `agents.ts:ucbC` — exploration constant (default 1.4).
- `agents.ts:rolloutDepth` — cap greedy rollouts (default 200).
- `curriculum.ts:CURRICULUM` — adjust rung sizes, episode counts.
