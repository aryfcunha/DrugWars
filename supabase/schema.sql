-- Idempotent — safe to re-run.
-- Run this in your Supabase project SQL editor.

create table if not exists public.drugwars_scores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 16),
  net_worth bigint not null,
  days int not null check (days between 1 and 9999),
  created_at timestamptz not null default now()
);

-- Migration: add `mode` column for endless vs fixed-duration runs.
-- For 'fixed' mode, `days` stores the tour length the player chose (15/30/60/90).
-- For 'endless' mode, `days` stores how many days the player survived.
alter table public.drugwars_scores
  add column if not exists mode text not null default 'fixed';

alter table public.drugwars_scores
  drop constraint if exists drugwars_scores_mode_check;

alter table public.drugwars_scores
  add constraint drugwars_scores_mode_check
  check (mode in ('fixed', 'endless'));

-- Relax days check to allow endless-survival counts (you'd never live 9999, but
-- we want the bound large enough that a degenerate run can't be silently rejected).
alter table public.drugwars_scores
  drop constraint if exists drugwars_scores_days_check;

alter table public.drugwars_scores
  add constraint drugwars_scores_days_check
  check (days between 1 and 9999);

-- Index for fast per-board lookups (mode + days bucket + ordered by score).
create index if not exists drugwars_scores_board_idx
  on public.drugwars_scores (mode, net_worth desc);

create index if not exists drugwars_scores_fixed_bucket_idx
  on public.drugwars_scores (mode, days, net_worth desc);

alter table public.drugwars_scores enable row level security;

-- Anyone can read scores.
drop policy if exists "scores_select" on public.drugwars_scores;
create policy "scores_select"
  on public.drugwars_scores for select
  using (true);

-- Anyone (anon) can insert a score row.
drop policy if exists "scores_insert" on public.drugwars_scores;
create policy "scores_insert"
  on public.drugwars_scores for insert
  with check (
    net_worth between -1000000 and 1000000000
    and char_length(name) between 1 and 16
    and mode in ('fixed', 'endless')
    and days between 1 and 9999
  );
