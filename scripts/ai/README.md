# Drug Wars AI

Self-play AI for Drug Wars. AlphaZero-shaped (MCTS + future learned value
function) but pragmatically scoped: pure TypeScript/Node, imports the game's
reducer directly for ground-truth telemetry, runs entirely headless.

## Quick start

```bash
# Benchmark all three agents at a single horizon
npm run ai:eval -- --days 30 --n 30

# Single agent, custom MCTS budget
npm run ai:eval -- --days 60 --n 10 --agent mcts --sims 3000

# Quick pipeline validation (~5 min on a laptop)
npm run ai:train -- --quick

# Full curriculum (~1-2 hours; 3D → 90D → endless)
npm run ai:train

# Full curriculum + submit best run per rung to leaderboard
# (requires .env.local with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
npm run ai:train:submit

# Run a single rung of the curriculum (index 0..7)
npx tsx scripts/ai/cli.ts train --only 4
```

## Architecture

| File             | Role |
|------------------|------|
| `sim.ts`         | Headless wrapper around `src/game/reducer.ts`. Auto-resolves trivial event modals so the agent only sees actual decision points. |
| `actions.ts`     | Discretized action space: `BUY_MAX`/`BUY_HALF`/`SELL_ALL`/`SELL_HALF` per drug, `TRAVEL_*`, `BUY_COAT`, `PAY_DEBT_ALL`, `DEPOSIT_ALL`, `WITHDRAW_ALL`, `FIGHT`/`RUN`, `ACCEPT_OFFER`/`DECLINE_OFFER`, `RETIRE`. |
| `agents.ts`      | Three agents: `RANDOM` (uniform), `GREEDY` (hand-crafted heuristic), `MCTS` (UCB1 tree search with greedy rollouts). |
| `eval.ts`        | Benchmark harness — runs N seeds, reports mean / median / p95 / min / max net worth. |
| `curriculum.ts`  | 8-rung curriculum from 3D → 90D → endless. Each rung: baseline (greedy) vs current MCTS, log to `runs/*.jsonl`, optionally submit best to Supabase. |
| `submit.ts`      | Supabase client. Reads `.env.local`. Versioned names: `AI_MCTS_v1`, `AI_GREEDY_v1` (16-char cap). |
| `cli.ts`         | Entry point. `npm run ai:eval -- ...` / `npm run ai:train -- ...`. |

## Algorithm

The game is stochastic (random events, market prices, cop fights), so true
AlphaZero (deterministic-env MCTS + NN) doesn't apply directly. Instead:

1. **MCTS with UCB1 selection.** Standard formula:
   `argmax_a Q(s,a) + c·sqrt(ln N(s)/N(s,a))` with `c=1.4`.
2. **Greedy rollouts.** When a tree leaf is reached, we play out the rest of
   the game using the hand-crafted `GREEDY` policy. This gives much lower
   variance than random rollouts on long horizons.
3. **Value squashing.** Final net worth is mapped through `tanh(nw / 30_000)`
   so the UCB exploration constant is well-scaled regardless of game length.
4. **Tree rebuilt per turn.** The high stochasticity makes cached subtrees low
   value, and rebuilding keeps the implementation simple.

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
- [ ] **Learned value function** — replace greedy rollouts with a linear
      function approximator trained on MCTS returns. Adds the "learning" loop
      that closes the AlphaZero gap.
- [ ] **Self-play data collection** — log `(state_features, π_MCTS, return)`
      for offline training.
- [ ] **Better state featurization** — currently rollouts get raw `FullState`;
      a learned value function needs a fixed-size feature vector.
- [ ] **Parallel rollouts** — Worker threads for 4× MCTS throughput.

## Tunables

- `agents.ts:valueOf` — change the reward squashing (`tanh(nw/30k)`).
- `agents.ts:ucbC` — exploration constant (default 1.4).
- `agents.ts:rolloutDepth` — cap greedy rollouts (default 200).
- `curriculum.ts:CURRICULUM` — adjust rung sizes, episode counts.
