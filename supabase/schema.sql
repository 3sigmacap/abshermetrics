-- AbsherMetrics — Supabase schema + Row-Level Security
-- Run this once in the Supabase dashboard → SQL Editor → New query → Run.
-- Safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS).
--
-- Model: store only RAW R50 shots per user. The app computes carries, trajectories,
-- dispersion, etc. on-device with flight-engine.js — no server compute needed.
-- RLS guarantees every user can read/write ONLY their own rows.

-- ── profiles ───────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles select own" on public.profiles;
drop policy if exists "profiles insert own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles select own" on public.profiles for select using (auth.uid() = id);
create policy "profiles insert own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles update own" on public.profiles for update using (auth.uid() = id);

-- auto-create a profile row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── sessions (one per uploaded range session) ──────────────────────────────
create table if not exists public.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  label      text not null,
  date       date,
  created_at timestamptz not null default now()
);

alter table public.sessions enable row level security;

drop policy if exists "sessions own" on public.sessions;
create policy "sessions own" on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists sessions_user_idx on public.sessions (user_id);

-- ── shots (raw R50 launch rows) ────────────────────────────────────────────
create table if not exists public.shots (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete cascade,
  club       text not null,
  ts         timestamptz,
  bs         double precision, -- ball speed (mph)
  la         double precision, -- launch angle (deg)
  ld         double precision, -- launch direction (deg)
  bspin      double precision, -- backspin (rpm)
  sspin      double precision, -- sidespin (rpm)
  spin       double precision, -- total spin (rpm)
  axis       double precision, -- spin axis (deg)
  apex       double precision, -- R50 apex (ft, reference)
  carry      double precision, -- R50 carry (yd, reference)
  total      double precision, -- R50 total (yd, reference)
  dev        double precision, -- R50 lateral deviation (yd, reference)
  excluded   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.shots enable row level security;

drop policy if exists "shots own" on public.shots;
create policy "shots own" on public.shots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists shots_user_idx on public.shots (user_id);
create index if not exists shots_session_idx on public.shots (session_id);
create index if not exists shots_user_club_idx on public.shots (user_id, club);
