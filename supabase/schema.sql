-- Run this in your Supabase project SQL editor.
-- Creates the leaderboard table and a permissive insert/read policy for anon clients.

create table if not exists public.drugwars_scores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 16),
  net_worth bigint not null,
  days int not null check (days between 1 and 365),
  created_at timestamptz not null default now()
);

create index if not exists drugwars_scores_net_worth_idx
  on public.drugwars_scores (net_worth desc);

alter table public.drugwars_scores enable row level security;

-- Anyone can read scores.
drop policy if exists "scores_select" on public.drugwars_scores;
create policy "scores_select"
  on public.drugwars_scores for select
  using (true);

-- Anyone (anon) can insert a score row.
-- Light defense-in-depth: cap net_worth in a reasonable range so a bad actor
-- can't spam absurd values. Tune as desired.
drop policy if exists "scores_insert" on public.drugwars_scores;
create policy "scores_insert"
  on public.drugwars_scores for insert
  with check (
    net_worth between -1000000 and 1000000000
    and char_length(name) between 1 and 16
  );
