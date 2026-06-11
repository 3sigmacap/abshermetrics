# Connections & Compare — build spec

Lets users link with other players ("connections") and compare bags. This doc is the
single source of truth — build from it. Apply to **web AND mobile** (parity rule, see
CLAUDE.md). Develop on the `connections` feature branch off `main` (main auto-deploys
to Render; merge per stable phase).

## ✅ STATUS (2026-06-10)
- **Phase A — link by email: DONE, merged to `main`.** connections module + Settings →
  Connections UI (add/accept/decline/remove) + pending badge, web + mobile.
- **Phase B — publish/view bag summary: DONE, merged to `main`.** publishBagSummary +
  loadBagSummary + "view a connection's bag" (web `connection-bag.html`, mobile
  `connection-bag.tsx`), reached from the Connections list.
- **Phase C — Compare: DONE, merged to `main`.** "Compare with a connection" button on the
  Bag (NOT a nav tab) → Compare view: gapping-ladder overlay + per-club carry/total delta
  table + avg-shot trajectory overlay (side + top-down). Web `compare.html` (SVG), mobile
  `compare.tsx` (react-native-svg). Reviewed via an adversarial multi-agent workflow;
  confirmed fixes applied (race guard, ?u validation, defensive guards, mobile total
  columns for parity). Both bags are aggregate-only — no raw-shot access.
- **Phase E — mobile push: DONE, merged to `main`.** push_tokens table + owner RLS;
  `_shared/push.ts` (Expo push API); `request-connection` pushes the addressee on a request
  (and the requester on auto-accept); new `notify-accept` Edge Function pushes the requester
  when the addressee accepts (server-side re-verifies caller == addressee of an ACCEPTED
  row). Mobile: expo-notifications (~56) + app.json plugin + `lib/push.tsx` (registerForPush
  + `<PushRegistrar/>`). Web/mobile accept both invoke notify-accept. Live-tested 13/13.
  **Ships to phones only with the next native build** (push code must be compiled in).
- **Backend is LIVE on Supabase (`uzqtotiilluwktewdlmr`) + verified.** Schema applied
  (connections, bag_summaries, are_connected, user_id_by_email + RLS); `request-connection`
  Edge Function deployed. Tested with real users: RLS isolation (connected can read the
  aggregate bag_summary, NOBODY can read raw shots) + upsert idempotency — all pass.
  The Supabase CLI is linked locally; the access token is in the macOS keychain
  (service "Supabase CLI", account "supabase") — read it with
  `security find-generic-password -s 'Supabase CLI' -a supabase -w` for future CLI ops,
  and set `SSL_CERT_FILE=/etc/ssl/cert.pem` for python; the Management API blocks the
  default python User-Agent (use curl or a browser UA).
- **iOS 1.0.1 shipped to Apple (2026-06-10):** EAS build **#6** (version/runtime **1.0.1**,
  commit `810c9c1`) finished + auto-uploaded to App Store Connect. First `expo-updates` build,
  so OTA works for 1.0.1+ once live. iOS **push credentials are set up in EAS** (Push
  Notifications capability enabled on the App ID + provisioning profile regenerated + APNs key
  created — done via an INTERACTIVE `eas build`). Apple side: v1.0 was "Waiting for Review";
  recommended path = **Remove 1.0 from review → change version to 1.0.1 → attach build 6 →
  Submit** (a 1.0.1 build can't attach to a "1.0" App Store version). Owner does that final
  App Store Connect submit-for-review.
- **Android NOT built yet:** same 1.0.1 code on `main`; needs `app/google-play-key.json` (store
  submit) + FCM credentials in Expo (push delivery), then
  `npx eas-cli build -p android --profile production --auto-submit`.
- **Phase D — email invites: BUILT (2026-06-11), on branch `connections-phase-d`.** When you
  add a connection by an email with no account, `request-connection` now sends an email invite
  (`inviteUserByEmail`) + creates a PENDING connection to the freshly-invited user + logs an
  `invites` audit row → returns `invited`. The invitee lands on the new **`welcome.html`**, sets
  name + password, and is **auto-connected to the inviter** (scoped to `invited_by` only — other
  pending requests stay manual, so no unconsented auto-accept). Per-account **daily invite cap**
  (`MAX_INVITES_PER_DAY`, default 25) guards against spam/quota abuse. Reviewed via an adversarial
  multi-agent workflow; confirmed fixes applied (rate limit, generic error copy to avoid an SMTP-
  state leak, Postgres `23505` duplicate guard, best-effort logging, gated welcome copy).
  **Production config the owner must set (else invites silently no-op):**
  1. **Custom SMTP** in Supabase Auth (we're using **Resend**) — without it every invite returns
     `invite_failed`.
  2. **Redirect allow-list:** add `https://abshermetrics.com/welcome.html` under Supabase Auth →
     URL Configuration → Redirect URLs (else the invite link falls back to the Site URL and the
     invitee never reaches the set-password page).
  3. **Customize the "Invite user" email template** to name AbsherMetrics + the inviter
     (`{{ .Data.invited_by_name }}` is available from the invite metadata).
  - **Mobile invitees:** email links open in the phone's **browser** → they finish on `welcome.html`,
    then sign in on the native app with the password they set (web session does not transfer to the
    app's AsyncStorage). This is expected/standard; a native deep-link is a possible future polish.

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
Phases **A–C + E are DONE and live on web** (`main`); backend live + verified (see STATUS).
What's left is optional and only if the user asks:
1. **Mobile release** — iOS **1.0.1 (EAS build #6)** is built + uploaded to App Store Connect;
   owner finishes the App Store Connect submit-for-review (remove 1.0 from review → set version
   1.0.1 → attach build 6). **Android still pending**: add `app/google-play-key.json` + FCM
   creds, then `npx eas-cli build -p android --profile production --auto-submit`. Gotchas seen:
   bare `eas` isn't on PATH here — use `npx eas-cli ...`; the FIRST build after adding push must
   run **interactive** (no `--non-interactive`) so EAS prompts to enable the Push Notifications
   capability + regenerate the profile (a non-interactive build reuses the stale profile and
   fails on `aps-environment`).
2. **Phase D — email invites** (web + mobile): extend `request-connection` so a non-user
   email creates an `invite` row + `auth.admin.inviteUserByEmail(...)`; auto-connect on
   signup; request/accept emails. **Needs custom SMTP configured in Supabase Auth** (owner).
3. CLI ops: Supabase CLI is linked; token in keychain (service "Supabase CLI", acct
   "supabase"); `db query --linked` / `functions deploy --project-ref uzqtotiilluwktewdlmr`
   need `SUPABASE_ACCESS_TOKEN` (read from keychain) + `SSL_CERT_FILE=/etc/ssl/cert.pem`
   for python; Management API blocks the default python UA (use curl/browser UA).
