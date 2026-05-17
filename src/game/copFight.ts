import type { Rng } from './rng';

// Simple turn-based cop fight: each "round" player decides FIGHT or RUN.
// FIGHT: damage to cops based on player guns; cops shoot back, do HP damage.
// RUN: chance to escape based on count of cops & remaining hp.

export interface CopFight {
  copsLeft: number;
  log: string[];
}

export function newFight(cops: number): CopFight {
  return { copsLeft: cops, log: [`${cops} officers in pursuit!`] };
}

export function fightRound(
  rng: Rng,
  fight: CopFight,
  guns: number,
  hp: number,
): { fight: CopFight; hp: number; resolved: 'win' | 'dead' | 'ongoing' } {
  if (guns <= 0) {
    // No gun: instant heavy damage
    const dmg = rng.int(15, 30) * Math.max(1, fight.copsLeft);
    const newHp = Math.max(0, hp - dmg);
    return {
      fight: { ...fight, log: [...fight.log, `You have no gun! Cops shoot you for ${dmg} HP.`] },
      hp: newHp,
      resolved: newHp <= 0 ? 'dead' : 'ongoing',
    };
  }
  // Player shoots — kill chance per cop scales with guns
  const hitChance = Math.min(0.85, 0.35 + guns * 0.15);
  let killed = 0;
  for (let i = 0; i < fight.copsLeft; i++) {
    if (rng.chance(hitChance / Math.max(1, fight.copsLeft - i))) killed++;
  }
  killed = Math.min(fight.copsLeft, killed);
  const copsLeft = fight.copsLeft - killed;
  const log = [...fight.log, killed > 0 ? `You took down ${killed} officer${killed === 1 ? '' : 's'}!` : 'You missed!'];

  if (copsLeft <= 0) {
    return { fight: { copsLeft: 0, log: [...log, 'You escaped!'] }, hp, resolved: 'win' };
  }
  // Cops shoot back
  const dmg = rng.int(5, 15) * copsLeft;
  const newHp = Math.max(0, hp - dmg);
  log.push(`Cops shoot back — you take ${dmg} HP damage.`);
  return {
    fight: { copsLeft, log },
    hp: newHp,
    resolved: newHp <= 0 ? 'dead' : 'ongoing',
  };
}

export function runRound(
  rng: Rng,
  fight: CopFight,
  hp: number,
): { escape: boolean; hp: number; fight: CopFight; resolved: 'win' | 'dead' | 'ongoing' } {
  const escapeP = Math.max(0.2, 0.7 - fight.copsLeft * 0.07);
  const escape = rng.chance(escapeP);
  if (escape) {
    return { escape, hp, fight: { ...fight, log: [...fight.log, 'You ditched the cops in an alley!'] }, resolved: 'win' };
  }
  const dmg = rng.int(5, 12) * fight.copsLeft;
  const newHp = Math.max(0, hp - dmg);
  return {
    escape: false,
    hp: newHp,
    fight: { ...fight, log: [...fight.log, `You tripped! Cops catch up — ${dmg} HP damage.`] },
    resolved: newHp <= 0 ? 'dead' : 'ongoing',
  };
}
