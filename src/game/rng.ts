// Tiny seeded PRNG (mulberry32) so games are reproducible if we ever want to.
export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function rand() {
    t |= 0; t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}

export interface Rng {
  (): number;
  int: (min: number, max: number) => number;
  pick: <T>(arr: readonly T[]) => T;
  chance: (p: number) => boolean;
}

export function makeRng(seed: number): Rng {
  const r = mulberry32(seed);
  const fn = (() => r()) as Rng;
  fn.int = (min: number, max: number) => Math.floor(r() * (max - min + 1)) + min;
  fn.pick = <T,>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)];
  fn.chance = (p: number) => r() < p;
  return fn;
}
