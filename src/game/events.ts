import { DRUGS, type DrugId, type EventKind } from './data';
import type { Rng } from './rng';

// Generated event payloads describe what already happened — the reducer applies them.
export interface GeneratedEvent {
  kind: EventKind;
  title: string;
  message: string;
  // Effects to apply when player dismisses the modal:
  cashDelta?: number;
  drugDelta?: Partial<Record<DrugId, number>>;
  hpDelta?: number;
  gunsDelta?: number;
  capacityDelta?: number;
  // Market modifiers for THIS visit (used to override price gen):
  priceMult?: Partial<Record<DrugId, number>>;
  forcePresent?: Partial<Record<DrugId, boolean>>;
  // Whether to start a cop fight (handled differently)
  startCopFight?: { guns: number };
  // Optional offer the player can accept / decline:
  offer?: {
    label: string;
    accept: { cashDelta?: number; gunsDelta?: number; capacityDelta?: number };
    decline?: { cashDelta?: number };
  };
}

// Probability for each event when entering a new location.
// These are independent rolls; the first hit fires (so order matters).
const EVENT_ROLLS: { kind: EventKind; p: number }[] = [
  { kind: 'cops', p: 0.0 },          // computed dynamically from copRisk
  { kind: 'mugger', p: 0.05 },
  { kind: 'find_drugs', p: 0.04 },
  { kind: 'find_coat', p: 0.03 },
  { kind: 'gun_for_sale', p: 0.05 },
  { kind: 'cheap_drug', p: 0.06 },
  { kind: 'good_deal', p: 0.05 },
  { kind: 'paraquat', p: 0.02 },
  { kind: 'lady_luck', p: 0.04 },
];

export function rollEvent(
  rng: Rng,
  ctx: { copRisk: number; hasDrugs: boolean; guns: number; cash: number },
): GeneratedEvent | null {
  // Cops first
  if (ctx.hasDrugs && rng.chance(ctx.copRisk)) {
    const officerCount = rng.int(2, 6);
    return {
      kind: 'cops',
      title: 'OFFICER HARDASS!',
      message: `${officerCount} officers spotted you! ${ctx.guns > 0 ? 'Will you fight or run?' : 'You have no gun — RUN!'}`,
      startCopFight: { guns: officerCount },
    };
  }
  for (const roll of EVENT_ROLLS) {
    if (roll.kind === 'cops') continue;
    if (rng.chance(roll.p)) {
      return makeEvent(rng, roll.kind, ctx);
    }
  }
  return null;
}

function makeEvent(
  rng: Rng,
  kind: EventKind,
  ctx: { hasDrugs: boolean; guns: number; cash: number },
): GeneratedEvent {
  switch (kind) {
    case 'mugger': {
      const loss = Math.min(ctx.cash, rng.int(50, 400));
      return {
        kind,
        title: 'MUGGED!',
        message: `A mugger jumped you in an alley and took $${loss}.`,
        cashDelta: -loss,
      };
    }
    case 'find_drugs': {
      const drug = rng.pick(DRUGS.filter(d => d.id === 'weed' || d.id === 'ludes' || d.id === 'speed'));
      const qty = rng.int(2, 8);
      return {
        kind,
        title: 'WHAT LUCK!',
        message: `You found ${qty} units of ${drug.name} on a dead dude in the subway!`,
        drugDelta: { [drug.id]: qty },
      };
    }
    case 'find_coat': {
      return {
        kind,
        title: 'NEW TRENCH COAT!',
        message: 'You find a bigger trench coat. (+10 capacity)',
        capacityDelta: 10,
      };
    }
    case 'gun_for_sale': {
      const price = rng.int(250, 600);
      return {
        kind,
        title: 'GUN FOR SALE',
        message: `A dealer offers a Saturday Night Special for $${price}.`,
        offer: {
          label: `BUY $${price}`,
          accept: { cashDelta: -price, gunsDelta: 1 },
          decline: {},
        },
      };
    }
    case 'cheap_drug': {
      // Marrakesh Express, cheap coke deal, etc.
      const drug = rng.pick(DRUGS);
      return {
        kind,
        title: drug.id === 'weed' ? 'MARRAKESH EXPRESS' : 'STREET DEAL',
        message:
          drug.id === 'weed'
            ? 'The Marrakesh Express has arrived — Weed is dirt cheap today!'
            : `Smugglers are dumping ${drug.name} at fire-sale prices today.`,
        priceMult: { [drug.id]: 0.25 },
        forcePresent: { [drug.id]: true },
      };
    }
    case 'good_deal': {
      const drug = rng.pick(DRUGS);
      return {
        kind,
        title: 'HOT MARKET',
        message: `Word on the street: ${drug.name} prices are sky-high today!`,
        priceMult: { [drug.id]: 3 },
        forcePresent: { [drug.id]: true },
      };
    }
    case 'paraquat': {
      // Original Drug Wars semantics: DEA poisoned the marijuana crop.
      // Player loses their entire weed stash and no weed is for sale today.
      // (Earlier this set price ≈ $1 which created a buy-low/move-it exploit.)
      return {
        kind,
        title: 'PARAQUAT!',
        message: 'DEA paraquat sprayed the weed crop. Your stash is ruined and nobody is selling today.',
        drugDelta: { weed: -100000 },
        forcePresent: { weed: false },
      };
    }
    case 'lady_luck': {
      const found = rng.int(100, 800);
      return {
        kind,
        title: 'LADY LUCK',
        message: `You found $${found} in a discarded jacket!`,
        cashDelta: found,
      };
    }
    default:
      return { kind, title: 'EVENT', message: '' };
  }
}
