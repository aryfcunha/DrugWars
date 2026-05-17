import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = url && anon ? createClient(url, anon) : null;

export const SUPABASE_CONFIGURED = !!supabase;

export interface LeaderEntry {
  id?: string;
  name: string;
  net_worth: number;
  days: number;
  created_at?: string;
}

export async function submitScore(entry: LeaderEntry): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Leaderboard not configured.' };
  const { error } = await supabase.from('drugwars_scores').insert({
    name: entry.name.slice(0, 16),
    net_worth: entry.net_worth,
    days: entry.days,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function fetchTopScores(limit = 25): Promise<LeaderEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('drugwars_scores')
    .select('id,name,net_worth,days,created_at')
    .order('net_worth', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data as LeaderEntry[];
}
