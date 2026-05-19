// Headless game simulator — wraps src/game/reducer.ts for self-play.
//
// The reducer in the React app exposes intermediate modal phases ('event',
// 'fighting_cops') that pause for human input. For the AI, we collapse those
// into single decision points by auto-dismissing trivial modals (EVENT_OK)
// and surfacing the agent's choice only for substantive ones (FIGHT vs RUN,
// ACCEPT vs DECLINE a gun offer).

import {
  reducer, makeFullInitial, type Action, type FullState,
} from '../../src/game/reducer.ts';
import { netWorth } from '../../src/game/state.ts';
import { LOCATIONS } from '../../src/game/data.ts';

export type { Action, FullState };
export { netWorth, LOCATIONS };

/** Start a fresh game. Seed is required for reproducibility. */
export function startGame(seed: number, totalDays: number, mode: 'fixed' | 'endless' = 'fixed'): FullState {
  let s = makeFullInitial(totalDays, seed, mode);
  s = reducer(s, { type: 'START_GAME' });
  // Auto-resolve any opening event (non-cop) so the agent always starts in 'playing'.
  s = autoResolveModals(s);
  return s;
}

export function isTerminal(s: FullState): boolean {
  return s.phase === 'game_over';
}

/** Apply an action, then auto-resolve modals back to a 'playing' or terminal state.
 *  Returns the new state. If the action is illegal, the reducer simply returns the
 *  same state — callers should use legalActions() to avoid that. */
export function step(s: FullState, action: Action): FullState {
  let next = reducer(s, action);
  next = autoResolveModals(next);
  return next;
}

/** Drain trivial modal phases automatically (the agent only sees decision points).
 *  - 'event' with no offer: auto EVENT_OK (apply effects + advance).
 *  - 'event' with offer: leave for the agent to decide ACCEPT/DECLINE.
 *  - 'fighting_cops': leave for the agent to decide FIGHT/RUN. */
export function autoResolveModals(s: FullState): FullState {
  let cur = s;
  let safety = 32;
  while (safety-- > 0) {
    if (cur.phase === 'event' && !cur.pendingEventGenerated?.offer && !cur.pendingEventGenerated?.startCopFight) {
      cur = reducer(cur, { type: 'EVENT_OK' });
      continue;
    }
    // event with cop-fight start: forward to 'fighting_cops' for the agent
    if (cur.phase === 'event' && cur.pendingEventGenerated?.startCopFight) {
      cur = reducer(cur, { type: 'EVENT_OK' });
      continue;
    }
    break;
  }
  return cur;
}

/** Net-worth delta from start of game — the canonical reward signal. */
export const STARTING_NET_WORTH = 2000 - 5500; // cash - debt

export function reward(s: FullState): number {
  return netWorth(s) - STARTING_NET_WORTH;
}

/** Pretty single-line state summary for logs. */
export function summary(s: FullState): string {
  const loc = s.locationId.padEnd(9);
  const drugs = Object.entries(s.inv.drugs)
    .filter(([, q]) => q > 0)
    .map(([d, q]) => `${d.slice(0, 3)}=${q}`)
    .join(' ') || '-';
  return `D${s.day}/${s.totalDays} ${loc} $${s.cash} bk=${s.bank} debt=${s.debt} hp=${s.hp} ${drugs} NW=${netWorth(s)}`;
}
