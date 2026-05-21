// Monte Carlo combat solver.
// Uses the real fightRound/runRound from src/game/copFight.ts so we never drift
// from the actual game mechanics.

import { newFight, fightRound, runRound } from '../../../src/game/copFight';
import { makeRng } from '../../../src/game/rng';

export interface CombatOutcome {
  pWin: number;        // P(survive | strategy)
  eHpAfter: number;    // E[hp after combat | survived]
  eLoot: number;       // E[loot gained | won by fighting]
  eDrops: number;      // E[drug units dropped | survived by running]
}

const HP_BUCKETS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const COP_RANGE = [2, 3, 4, 5, 6];
const GUN_RANGE = [0, 1, 2, 3, 4, 5];

const ROLLOUTS = 5000;

function simulateFight(seed: number, cops: number, hp: number, guns: number): { win: boolean; hpAfter: number; loot: number } {
  const rng = makeRng(seed);
  let fight = newFight(cops);
  let curHp = hp;
  while (true) {
    const r = fightRound(rng, fight, guns, curHp);
    fight = r.fight;
    curHp = r.hp;
    if (r.resolved === 'win') {
      const loot = rng.int(50, 400) * guns;
      return { win: true, hpAfter: curHp, loot };
    }
    if (r.resolved === 'dead') return { win: false, hpAfter: 0, loot: 0 };
  }
}

function simulateRun(seed: number, cops: number, hp: number): { escaped: boolean; hpAfter: number; attempts: number } {
  const rng = makeRng(seed);
  let fight = newFight(cops);
  let curHp = hp;
  let attempts = 0;
  while (true) {
    attempts++;
    const r = runRound(rng, fight, curHp);
    fight = r.fight;
    curHp = r.hp;
    if (r.escape) return { escaped: true, hpAfter: curHp, attempts };
    if (r.resolved === 'dead') return { escaped: false, hpAfter: 0, attempts };
    // else keep trying
  }
}

export interface CombatTable {
  fight: Record<string, CombatOutcome>;
  run: Record<string, CombatOutcome>;
}

export function keyOf(cops: number, hpBucket: number, guns: number): string {
  return `${cops}|${hpBucket}|${guns}`;
}

export function nearestHpBucket(hp: number): number {
  let best = HP_BUCKETS[0];
  let bestD = Math.abs(hp - best);
  for (const b of HP_BUCKETS) {
    const d = Math.abs(hp - b);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

export function buildCombatTable(): CombatTable {
  const fight: Record<string, CombatOutcome> = {};
  const run: Record<string, CombatOutcome> = {};

  for (const cops of COP_RANGE) {
    for (const hp of HP_BUCKETS) {
      for (const guns of GUN_RANGE) {
        // FIGHT
        let wins = 0, hpSum = 0, lootSum = 0;
        for (let i = 0; i < ROLLOUTS; i++) {
          const r = simulateFight(0x9E3779B1 ^ (cops << 16) ^ (hp << 8) ^ (guns << 4) ^ i, cops, hp, guns);
          if (r.win) {
            wins++;
            hpSum += r.hpAfter;
            lootSum += r.loot;
          }
        }
        fight[keyOf(cops, hp, guns)] = {
          pWin: wins / ROLLOUTS,
          eHpAfter: wins > 0 ? hpSum / wins : 0,
          eLoot: wins > 0 ? lootSum / wins : 0,
          eDrops: 0,
        };

        // RUN (guns don't matter for run; key still includes guns for uniform lookup)
        let escapes = 0, runHpSum = 0, attemptsSum = 0;
        for (let i = 0; i < ROLLOUTS; i++) {
          const r = simulateRun(0x85EBCA77 ^ (cops << 16) ^ (hp << 8) ^ i, cops, hp);
          if (r.escaped) {
            escapes++;
            runHpSum += r.hpAfter;
          }
          attemptsSum += r.attempts;
        }
        // E[drops] = 1 drop per successful escape; drop size = uniform 1-5 ⇒ E=3
        run[keyOf(cops, hp, guns)] = {
          pWin: escapes / ROLLOUTS,
          eHpAfter: escapes > 0 ? runHpSum / escapes : 0,
          eLoot: 0,
          eDrops: 3,
        };
      }
    }
  }
  return { fight, run };
}

export function lookup(table: CombatTable, mode: 'fight' | 'run', cops: number, hp: number, guns: number): CombatOutcome {
  const c = Math.max(2, Math.min(6, cops));
  const g = Math.max(0, Math.min(5, guns));
  const h = nearestHpBucket(hp);
  const key = keyOf(c, h, g);
  return (mode === 'fight' ? table.fight : table.run)[key];
}

// CLI: build & write the table.
function isMain() {
  const argv1 = process.argv[1]?.replace(/\\/g, '/');
  const url = import.meta.url.replace(/\\/g, '/');
  return argv1 && (url.endsWith(argv1) || url === `file:///${argv1}` || url === `file://${argv1}`);
}
if (isMain()) {
  const start = Date.now();
  console.log('Building combat table (this takes ~30s)...');
  const table = buildCombatTable();
  const dt = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Built in ${dt}s. Sample lookups:`);
  for (const cops of [2, 4, 6]) {
    for (const guns of [0, 1, 2, 3]) {
      const f = lookup(table, 'fight', cops, 100, guns);
      const r = lookup(table, 'run', cops, 100, guns);
      console.log(
        `  cops=${cops} hp=100 guns=${guns}: ` +
        `FIGHT pWin=${f.pWin.toFixed(2)} eHp=${f.eHpAfter.toFixed(0)} eLoot=$${f.eLoot.toFixed(0)} | ` +
        `RUN pEscape=${r.pWin.toFixed(2)} eHp=${r.eHpAfter.toFixed(0)}`
      );
    }
  }
  const fs = await import('node:fs');
  const path = await import('node:path');
  const outDir = path.resolve('scripts/ai/runs');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'combat_table.json');
  fs.writeFileSync(outPath, JSON.stringify(table));
  console.log(`Wrote ${outPath}`);
}
