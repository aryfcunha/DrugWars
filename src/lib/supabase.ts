import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = url && anon ? createClient(url, anon) : null;

export const SUPABASE_CONFIGURED = !!supabase;

export type LeaderMode = 'fixed' | 'endless';

export interface LeaderEntry {
  id?: string;
  name: string;
  net_worth: number;
  days: number;
  mode: LeaderMode;
  created_at?: string;
}

export async function submitScore(entry: LeaderEntry): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Leaderboard not configured.' };
  const { error } = await supabase.from('drugwars_scores').insert({
    name: entry.name.slice(0, 16),
    net_worth: entry.net_worth,
    days: entry.days,
    mode: entry.mode,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Fetch the top scores for a given board.
 * - Fixed board: pass `mode='fixed'` and `days` to filter to one tour length bucket (15/30/60/90).
 * - Endless board: pass `mode='endless'` and omit `days`.
 */
export async function fetchTopScores(
  opts: { mode: LeaderMode; days?: number; limit?: number } = { mode: 'fixed', days: 30, limit: 50 },
): Promise<LeaderEntry[]> {
  if (!supabase) return [];
  const limit = opts.limit ?? 50;
  let query = supabase
    .from('drugwars_scores')
    .select('id,name,net_worth,days,mode,created_at')
    .eq('mode', opts.mode)
    .order('net_worth', { ascending: false })
    .limit(limit);
  if (opts.mode === 'fixed' && opts.days != null) {
    query = query.eq('days', opts.days);
  }
  const { data, error } = await query;
  if (error) return [];
  return data as LeaderEntry[];
}
