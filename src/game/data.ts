// Static game data — drugs, locations, events.
// Calibrated to feel like the original TI Drug Wars but with slightly tighter ranges.

export type DrugId =
  | 'cocaine'
  | 'heroin'
  | 'acid'
  | 'weed'
  | 'speed'
  | 'ludes';

export interface Drug {
  id: DrugId;
  name: string;
  min: number;
  max: number;
  color: string;     // pixel-art color
  glyph: string;     // unicode glyph fallback
}

export const DRUGS: Drug[] = [
  { id: 'cocaine', name: 'Cocaine', min: 15000, max: 29000, color: '#ffffff', glyph: '❄' },
  { id: 'heroin',  name: 'Heroin',  min: 5000,  max: 13000, color: '#b8860b', glyph: '◉' },
  { id: 'acid',    name: 'Acid',    min: 1000,  max: 4500,  color: '#ff66ff', glyph: '✦' },
  { id: 'weed',    name: 'Weed',    min: 300,   max: 900,   color: '#34e07a', glyph: '✿' },
  { id: 'speed',   name: 'Speed',   min: 70,    max: 250,   color: '#4ad6ff', glyph: '⚡' },
  { id: 'ludes',   name: 'Ludes',   min: 10,    max: 60,    color: '#ffcb05', glyph: '◆' },
];

export const DRUG_BY_ID = Object.fromEntries(DRUGS.map(d => [d.id, d])) as Record<DrugId, Drug>;

export interface Location {
  id: string;
  name: string;
  // Cop encounter base probability per visit
  copRisk: number;
  // Multiplier on event variance/quality
  flavor: string;
}

export const LOCATIONS: Location[] = [
  { id: 'bronx',    name: 'The Bronx',   copRisk: 0.10, flavor: 'Loan shark & bank' },
  { id: 'ghetto',   name: 'Ghetto',      copRisk: 0.19, flavor: 'Cheap, dangerous' },
  { id: 'central',  name: 'Central Park',copRisk: 0.07, flavor: 'Tourists & hippies' },
  { id: 'manhattan',name: 'Manhattan',   copRisk: 0.15, flavor: 'High rollers' },
  { id: 'coney',    name: 'Coney Island',copRisk: 0.05, flavor: 'Quiet boardwalk' },
  { id: 'brooklyn', name: 'Brooklyn',    copRisk: 0.10, flavor: 'Middle ground' },
];

export const LOCATION_BY_ID = Object.fromEntries(LOCATIONS.map(l => [l.id, l])) as Record<string, Location>;

// Starting parameters
export const START_CASH = 2000;
export const START_DEBT = 5500;
export const DEBT_INTEREST = 0.10; // 10% per day
export const BANK_INTEREST = 0.05; // 5% per day
export const START_CAPACITY = 100;
export const TRENCH_COAT_BONUS = 10;
export const TRENCH_COAT_COST = 200;
export const START_HP = 100;
export const START_GUNS = 0;

export type EventKind =
  | 'cops'
  | 'find_drugs'
  | 'mugger'
  | 'cheap_drug'        // Marrakesh Express (cheap weed), cheap coke etc.
  | 'paraquat'          // Weed becomes dangerous
  | 'find_coat'
  | 'gun_for_sale'
  | 'good_deal'
  | 'lady_luck'         // Found money
  ;

export interface GameEvent {
  kind: EventKind;
  // Filled by event handler at runtime
  payload?: Record<string, unknown>;
}
