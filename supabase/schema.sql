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

-- per-user club specs (lofts, in-bag) + app preferences (added for Settings).
alter table public.profiles add column if not exists club_specs jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists prefs jsonb not null default '{}'::jsonb;

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

-- ════════════════════════════════════════════════════════════════════════════
-- CONNECTIONS & COMPARE  (see CONNECTIONS_PLAN.md)
-- Players link by email ("connections", mutual). Connections may read each other's
-- aggregated bag_summaries ONLY — never raw shots/sessions (those stay owner-only).
-- ════════════════════════════════════════════════════════════════════════════

-- ── connections (player-to-player links) ────────────────────────────────────
create table if not exists public.connections (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  -- Denormalized display info, written by the request-connection Edge Function
  -- (service-role). Lets each side show WHO they're linked with WITHOUT reading the
  -- other person's owner-only profiles row. Only ever a name + email of someone you
  -- are explicitly connecting with — never any shot data.
  requester_name  text,
  requester_email text,
  addressee_name  text,
  addressee_email text,
  status       text not null default 'pending',  -- 'pending' | 'accepted'  (room for 'blocked')
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

alter table public.connections enable row level security;

create index if not exists connections_requester_idx on public.connections (requester_id);
create index if not exists connections_addressee_idx on public.connections (addressee_id);

-- Either participant may read or delete (remove/decline) the row.
drop policy if exists "connections select own" on public.connections;
create policy "connections select own" on public.connections
  for select using (auth.uid() in (requester_id, addressee_id));

drop policy if exists "connections delete own" on public.connections;
create policy "connections delete own" on public.connections
  for delete using (auth.uid() in (requester_id, addressee_id));

-- Direct client INSERT only with yourself as requester AND status forced to 'pending'
-- (defense-in-depth) so a client can never self-grant an 'accepted' connection (which
-- would expose the addressee's bag_summary without consent). The normal path is the
-- Edge Function, which uses service_role to set both sides.
drop policy if exists "connections insert own" on public.connections;
create policy "connections insert own" on public.connections
  for insert with check (auth.uid() = requester_id and addressee_id <> requester_id and status = 'pending');

-- Only the addressee can accept (flip a pending row to accepted).
drop policy if exists "connections accept by addressee" on public.connections;
create policy "connections accept by addressee" on public.connections
  for update using (auth.uid() = addressee_id) with check (auth.uid() = addressee_id);

-- requester_id / addressee_id are immutable after creation. RLS can't restrict which
-- columns an UPDATE changes, so without this the addressee could repoint requester_id
-- at a third party. Only status / responded_at / display fields may change.
create or replace function public.connections_lock_identity()
returns trigger language plpgsql as $$
begin
  if new.requester_id is distinct from old.requester_id
     or new.addressee_id is distinct from old.addressee_id then
    raise exception 'requester_id / addressee_id are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists connections_lock_identity on public.connections;
create trigger connections_lock_identity before update on public.connections
  for each row execute function public.connections_lock_identity();

-- security-definer helper: true iff an ACCEPTED connection exists between a and b
-- (either direction). Used by the bag_summaries read policy.
create or replace function public.are_connected(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.connections c
    where c.status = 'accepted'
      and ( (c.requester_id = a and c.addressee_id = b)
         or (c.requester_id = b and c.addressee_id = a) )
  );
$$;

-- Resolve an email -> auth user id. SERVICE-ROLE ONLY (revoked from anon/authenticated
-- to prevent email enumeration); the request-connection Edge Function calls it via RPC.
create or replace function public.user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;
revoke all on function public.user_id_by_email(text) from public;
revoke all on function public.user_id_by_email(text) from anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;

-- ── bag_summaries (aggregate-only data a connection may read) ────────────────
-- One row per user. summary = array of per-club objects (Overview columns + the
-- club's average/mean trajectory). NO per-shot data ever lives here. Populated
-- client-side by publishBagSummary() after any data change (wired in Phase B).
create table if not exists public.bag_summaries (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  summary      jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table public.bag_summaries enable row level security;

-- Read your own, OR a connection's (accepted). Connections get aggregate-only access.
drop policy if exists "bag_summaries select own or connected" on public.bag_summaries;
create policy "bag_summaries select own or connected" on public.bag_summaries
  for select using (auth.uid() = user_id or public.are_connected(auth.uid(), user_id));

-- Only the owner may publish/update their own summary.
drop policy if exists "bag_summaries insert own" on public.bag_summaries;
create policy "bag_summaries insert own" on public.bag_summaries
  for insert with check (auth.uid() = user_id);
drop policy if exists "bag_summaries update own" on public.bag_summaries;
create policy "bag_summaries update own" on public.bag_summaries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── push_tokens (Phase E: mobile push notifications) ────────────────────────
-- One row per device per user. The push SENDER (Edge Functions) reads these with
-- the service_role key (bypasses RLS); users manage only their own tokens.
create table if not exists public.push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  token      text not null,
  platform   text,                       -- 'ios' | 'android'
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);

alter table public.push_tokens enable row level security;

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

drop policy if exists "push_tokens own" on public.push_tokens;
create policy "push_tokens own" on public.push_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── invites (Phase D: email invites for non-users) ──────────────────────────
-- When you add a connection by an email that has no AbsherMetrics account yet, the
-- request-connection Edge Function sends an invite email (Supabase Auth
-- inviteUserByEmail) AND creates a pending connection to the freshly-invited user,
-- so your request is already waiting for them the moment they join. This table is an
-- audit record of those email invites. Rows are written ONLY by the Edge Function
-- (service_role); the inviter may read/delete their own. Never holds shot data.
create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  inviter_id  uuid not null references auth.users (id) on delete cascade,
  email       text not null,                       -- the invited (lowercased) email
  status      text not null default 'pending',     -- 'pending' | 'accepted'
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);

alter table public.invites enable row level security;

create index if not exists invites_inviter_idx on public.invites (inviter_id);
create index if not exists invites_email_idx on public.invites (lower(email));

-- The inviter may read/delete their own invite rows. There is NO insert/update policy
-- for clients: invites are created solely by the service-role Edge Function, so a
-- client can never forge or spam invite rows.
drop policy if exists "invites select own" on public.invites;
create policy "invites select own" on public.invites
  for select using (auth.uid() = inviter_id);

drop policy if exists "invites delete own" on public.invites;
create policy "invites delete own" on public.invites
  for delete using (auth.uid() = inviter_id);

-- ════════════════════════════════════════════════════════════════════════════
-- FOLLOWS  (spectator / "ghost" view — see CLAUDE.md / FOLLOWS_PLAN.md)
-- A FOLLOW lets one user (the follower) VIEW another user's (the followed) full
-- account READ-ONLY — raw shots, sessions, profile — once the followed user APPROVES.
-- This is deliberately different from connections (which share aggregate bag_summaries
-- only). A follower can never WRITE the followed user's data. Consent is mandatory:
-- only the followed user can approve a pending follow.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references auth.users (id) on delete cascade,  -- the viewer
  followed_id  uuid not null references auth.users (id) on delete cascade,  -- the player being viewed
  -- Denormalized display info (written by the follow-request Edge Function via
  -- service_role) so each side can show WHO without reading the other's profile.
  -- Only ever a name + email of someone in an explicit follow relationship.
  follower_name  text,
  follower_email text,
  followed_name  text,
  followed_email text,
  status       text not null default 'pending',  -- 'pending' | 'approved'
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  unique (follower_id, followed_id),
  check (follower_id <> followed_id)
);

alter table public.follows enable row level security;

create index if not exists follows_follower_idx on public.follows (follower_id);
create index if not exists follows_followed_idx on public.follows (followed_id);

-- Either participant may read or delete the row (delete = decline / revoke / cancel).
drop policy if exists "follows select own" on public.follows;
create policy "follows select own" on public.follows
  for select using (auth.uid() in (follower_id, followed_id));

drop policy if exists "follows delete own" on public.follows;
create policy "follows delete own" on public.follows
  for delete using (auth.uid() in (follower_id, followed_id));

-- Direct client INSERT only with yourself as the follower AND status forced to
-- 'pending' — so a client can NEVER self-grant an approved follow (that would bypass
-- the followed user's consent and expose raw shots). Only the followed user can
-- approve, via the UPDATE policy below. (The normal path is the follow-request Edge
-- Function using service_role; this client policy is defense-in-depth.)
drop policy if exists "follows insert own" on public.follows;
create policy "follows insert own" on public.follows
  for insert with check (auth.uid() = follower_id and followed_id <> follower_id and status = 'pending');

-- Only the FOLLOWED user can approve (flip a pending row to approved) — consent gate.
drop policy if exists "follows approve by followed" on public.follows;
create policy "follows approve by followed" on public.follows
  for update using (auth.uid() = followed_id) with check (auth.uid() = followed_id);

-- follower_id / followed_id are immutable after creation. RLS can't restrict which
-- columns an UPDATE changes, so without this the followed user could repoint
-- follower_id at a third party (granting them an unrequested follow). Only status /
-- responded_at / display fields may change via UPDATE.
create or replace function public.follows_lock_identity()
returns trigger language plpgsql as $$
begin
  if new.follower_id is distinct from old.follower_id
     or new.followed_id is distinct from old.followed_id then
    raise exception 'follower_id / followed_id are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists follows_lock_identity on public.follows;
create trigger follows_lock_identity before update on public.follows
  for each row execute function public.follows_lock_identity();

-- security-definer helper: true iff `p_follower` has an APPROVED follow of `p_followed`.
-- Used by the read-grant policies below. Directional (follower → followed).
create or replace function public.is_following(p_follower uuid, p_followed uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.follows f
    where f.status = 'approved'
      and f.follower_id = p_follower
      and f.followed_id = p_followed
  );
$$;

-- ── Follower READ grants (the core of the feature) ──────────────────────────
-- These are ADDITIVE, SELECT-only policies. RLS policies are permissive (OR'd), so
-- the existing owner-only "for all" policies still govern INSERT/UPDATE/DELETE — a
-- follower gets READ access ONLY, and only while an approved follow exists. The owner
-- always retains full control and can revoke (delete the follow) at any time.
drop policy if exists "shots followers read" on public.shots;
create policy "shots followers read" on public.shots
  for select using (public.is_following(auth.uid(), user_id));

drop policy if exists "sessions followers read" on public.sessions;
create policy "sessions followers read" on public.sessions
  for select using (public.is_following(auth.uid(), user_id));

-- Followers need the followed user's profile (display_name, club_specs, prefs) to
-- render the bag/analytics correctly. Read-only; the owner-only update policy stands.
drop policy if exists "profiles followers read" on public.profiles;
create policy "profiles followers read" on public.profiles
  for select using (public.is_following(auth.uid(), id));
