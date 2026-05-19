// Submit AI run results to the Supabase leaderboard.
//
// Reads .env for VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Names are
// versioned so successive AI iterations don't overwrite each other:
//   AI_<algo>_v<n>          e.g. "AI_MCTS_v1"
// Note: the `name` column is capped at 16 chars by the existing submitScore.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(import.meta.dirname, '..', '..');

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of ['.env.local', '.env']) {
    const p = resolve(ROOT, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(m[1] in out)) out[m[1]] = v;
    }
  }
  return out;
}

let _client: ReturnType<typeof createClient> | null | undefined;
function client() {
  if (_client !== undefined) return _client;
  const env = { ...process.env, ...loadEnv() };
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn('[submit] VITE_SUPABASE_URL/ANON_KEY not set — submission disabled');
    _client = null;
    return null;
  }
  _client = createClient(url as string, key as string);
  return _client;
}

export async function submit(
  name: string,            // e.g. "AI_MCTS_v1"
  netWorth: number,
  days: number,
  mode: 'fixed' | 'endless',
): Promise<boolean> {
  const c = client();
  if (!c) return false;
  const { error } = await c.from('drugwars_scores').insert({
    name: name.slice(0, 16),
    net_worth: Math.round(netWorth),
    days,
    mode,
  });
  if (error) {
    console.error(`[submit] ${name} d=${days} nw=${netWorth}: ${error.message}`);
    return false;
  }
  console.log(`[submit] ✓ ${name.padEnd(16)} d=${days} nw=$${netWorth.toLocaleString()} mode=${mode}`);
  return true;
}
