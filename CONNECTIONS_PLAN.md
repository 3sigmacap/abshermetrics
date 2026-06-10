# Connections & Compare — build spec

Lets users link with other players ("connections") and compare bags. **Approved
design; build NOT started.** This doc is the single source of truth — build from it.
Apply to **web AND mobile** (parity rule, see CLAUDE.md). Develop on a `connections`
feature branch off `main` (main auto-deploys to Render; merge per stable phase).

## Locked decisions (from the design conversation)
1. **Share scope:** a player's **Bag/Overview summary only** — per-club aggregates,
   **plus each club's average (mean) trajectory**. **NEVER raw shots / per-shot rows.**
2. **Direction:** **mutual** — once a request is accepted, BOTH can see each other's bag.
3. **Compare:** build it now — gapping-ladder overlay + side-by-side per-club delta
   table + average-shot trajectory overlay.
4. **Add people by email.** Non-users get an **invite to join** + auto-connect on signup.
5. **Compare entry point:** a **button on the Bag** ("Compare with a connection") — NOT
   a new nav tab (keeps the menu identical across web + mobile, per the owner's rule).
6. **Notifications (all three, layered):** in-app badge (with the core) → email (when
   SMTP is set up) → **mobile** push (own phase). Web relies on in-app + email (no native
   phone push on web; browser Web-Push is optional/later).

## Why "Bag-only" ⇒ share an aggregated summary (key principle)
Every screen is computed **client-side** from raw shots. If a connection could read your
raw `shots` (naive RLS), they'd effectively have all your data even if the UI only drew
the Bag — so "Bag-only" wouldn't be enforced. Therefore connections **never read raw
shots**. Instead each user **publishes an aggregated `bag_summary`** (the Overview numbers
+ each club's mean trajectory — both aggregates) that connections may read. Raw
`shots`/`sessions` RLS stays locked to the owner, unchanged.

## Data model (add to `supabase/schema.sql`)
- **`connections`**: `id uuid pk`, `requester_id uuid`, `addressee_id uuid` (both →
  auth.users on delete cascade), `status text default 'pending'` (`'pending'|'accepted'`;
  room for `'blocked'` later), `created_at`, `responded_at`. `unique(requester_id,
  addressee_id)`. App prevents reverse-duplicate + self-connect.
- **`bag_summaries`**: `user_id uuid pk → auth.users`, `display_name text`,
  `summary jsonb default '[]'`, `updated_at`. `summary` = array of per-club objects:
  `{club, color, n, carry, total, apex, descent, ballSpeed, launchAngle, spin, carrySD,
  lateralSD, loft, mean:[x,y,z,...]}` — the Overview columns + the average trajectory.
  **No per-shot data.**
- **`invites`** (Phase D): `id, inviter_id, email, status('pending'|'accepted'),
  created_at`. (Supabase `inviteUserByEmail` sends the actual email.)
- **`push_tokens`** (Phase E): `id, user_id, token, platform('ios'|'android'),
  updated_at`, `unique(user_id, token)`.
- **`are_connected(a uuid, b uuid) returns boolean`** — SQL `security definer` helper:
  true if an `accepted` connection exists between a and b (either direction). Used by the
  `bag_summaries` read policy.

## RLS
- **connections**: SELECT/DELETE where `auth.uid() in (requester_id, addressee_id)`;
  INSERT with check `auth.uid() = requester_id and addressee_id <> requester_id`; UPDATE
  to `accepted` only by the addressee (`auth.uid() = addressee_id`).
- **bag_summaries**: SELECT where `auth.uid() = user_id OR are_connected(auth.uid(),
  user_id)`; INSERT/UPDATE only where `auth.uid() = user_id` (owner publishes own).
- **shots / sessions / profiles**: UNCHANGED — owner-only. Connections get read-only,
  aggregate-only access via `bag_summaries`; they can never read raw shots or write
  anything of yours.
- **invites / push_tokens**: owner-scoped as appropriate.

## Backend pieces
- **`request-connection` Edge Function** (needed from Phase A — the client can't read
  auth.users by email): input `{email}`. Uses service_role to resolve the email → user.
  If a user exists → insert a `pending` connection (requester = caller, addressee = found).
  If NOT (Phase D) → create an `invite` + `auth.admin.inviteUserByEmail(email, {data:
  {invited_by: callerId}})`. Returns `{status: 'requested'|'invited'|'already'|'self'}`.
  (Accept / decline / remove need NO function — the client does them directly via RLS:
  update status to accepted / delete the row.)
- **Bag-summary publisher (client-side):** after any data change (CSV upload, load sample,
  delete-all — and lazily on app load if missing), recompute ClubData (already done to
  render the Bag) and `upsert` `bag_summaries.summary` (per-club fields + `mean`). Lives in
  `user-data.js` / `dataStore.tsx` as `publishBagSummary()`.
- **Email (Phase D):** configure SMTP in Supabase Auth (owner action). Request/accept
  emails sent via an Edge Function or DB webhook on `connections` insert/update.
- **Push (Phase E):** mobile registers an Expo push token (expo-notifications) → store in
  `push_tokens`. An Edge Function (triggered on connection insert/accept) reads the
  addressee's tokens → POSTs to Expo's push API.

## Shared client modules (web `*.js` ↔ mobile `*.ts(x)`, kept in parity)
- `connections.js` / `lib/connections.ts`: list accepted; list pending in/out; request by
  email (calls the Edge Function); accept; decline; remove; pending-count (badge).
- `bag-summary.js` / `lib/bagSummary.ts`: `publishBagSummary()`; `loadBagSummary(userId)`
  (own or a connection's, via RLS).

## UI (web + mobile; mobile is the structural reference)
- **Settings → "Connections"** (web `settings.html`, mobile `settings.tsx`): add-by-email
  field; **Pending** (incoming = Accept/Decline; outgoing = "Pending"); **Connections**
  list with Remove; an unread badge on the Settings entry + the section.
- **Bag** (`index.html`, `app/src/app/index.tsx`): a **"⚖ Compare with a connection →"**
  button. Reached page is NOT in the nav (matches how raw-data/model are link-only).
- **Compare view** — web `compare.html` (auth-gated, link-only, not in nav); mobile
  `app/src/app/compare.tsx` (registered `href:null` in `_layout.tsx`, like raw-data/model).
  Pick a connection → **gapping ladder overlay** (both players' carry ladders on one
  chart) + **per-club delta table** (your carry vs theirs, ±) + **average-shot trajectory
  overlay** (your mean path vs theirs, reusing the existing side/top-down render).

## Phases (each shipped web + mobile, on the `connections` branch → merge to main)
- **A — Connections plumbing:** schema (connections, bag_summaries, are_connected) +
  `request-connection` Edge Function (existing users only) + `connections` module +
  Settings → Connections UI (add/accept/decline/remove) + in-app pending badge. No data
  shared yet.
- **B — Bag publish + read sharing:** `publishBagSummary()` wired into data mutations +
  `bag_summaries` read for connections + a basic "view a connection's bag."
- **C — Compare:** the Compare view (overlay + deltas + avg-trajectory) off the Bag button.
- **D — Email:** invites for non-users (extend the Edge Function) + request/accept emails.
  Needs SMTP configured in Supabase.
- **E — Mobile push:** push_tokens + Expo registration + sender Edge Function.

## Owner action items (backend)
- **Phase A:** run the new schema SQL in the Supabase SQL editor (I'll provide it); confirm
  the `request-connection` Edge Function deploy (existing `supabase/functions/delete-account`
  proves the deploy path works).
- **Phase D:** configure custom SMTP in Supabase Auth (or accept built-in limits for
  testing) — I'll guide.
- **Phase E:** nothing manual (app + function).

## Context a fresh session needs (existing architecture)
- Supabase ref `uzqtotiilluwktewdlmr`; tables profiles/sessions/shots + RLS in
  `supabase/schema.sql`; deployed `delete-account` Edge Function in `supabase/functions/`.
- Per-user data + compute: web `user-data.js` (loadClubData/loadRawData, uploadCsvFiles,
  load/delete) + `club-compute.js` (computeClubs); mobile `app/src/lib/dataStore.tsx` +
  `clubData.ts`; shared physics `flight-engine.js`. ClubData has `carry,total,apex,descent,
  ell{cx,cz,rx,rz},mean,shots,meanRoll,roll,derived,stats` — the summary pulls the scalar
  fields + `mean`.
- Bag screens: `index.html` / `app/src/app/index.tsx`. Settings: `settings.html` /
  `app/src/app/settings.tsx`. Auth: web `auth.js`/`auth-gate.js`, mobile `lib/auth.tsx`.
- Delivery (RELEASE.md): web → push `main` (Render). Mobile JS → `npm run ota` (needs the
  first expo-updates build, v1.0.1, to be live first); native → `npm run release`.
- Parity + standing rule: `CLAUDE.md`. Demo account: `demo@abshermetrics.com` /
  `AbsherDemo2026!` (keep pristine).

## Where to resume after compaction
1. Read this file + `CLAUDE.md` (auto-loaded) + `RELEASE.md`.
2. Confirm the locked decisions above with the user (one line) — then `git checkout -b
   connections` off `main`.
3. Start **Phase A**: write the schema SQL (hand it to the user to run) + the
   `request-connection` Edge Function + `connections` module + the Settings → Connections
   UI + in-app badge, **on web AND mobile**.
4. Verify in-browser (web) and reason through mobile; commit per phase; merge to `main`
   only when a phase is stable.
