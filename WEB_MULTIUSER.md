# Web app → multi-user (parity with the mobile apps)

Resume doc for bringing accounts + per-user data to the **web app**, so a user can
log into web, iOS, or Android with the same account and see their own data.
(Mobile apps are DONE and submitted; this is the web-side work.)

## The goal / architecture
One shared backend, three tailored frontends:
- **Supabase** (already built, multi-user, platform-neutral): accounts, database, auth.
- **Physics engine** (`flight-engine.js` at repo root): shared by web + mobile.
- **Frontends:** Web app (rich 3D visuals, primary) · iOS · Android (quick stats).

The web app currently is **static + single-user**: plain HTML/JS at the repo root
(`index.html`, `trends.html`, `club-detail.html`, `flight-3d.html`, `raw-data.html`,
`model.html`, `top-down.html`) that load **bundled** `shots.json` / `raw-shots.json`
(one person's data). The job is to make it load the **signed-in user's** data from
Supabase instead — while keeping its existing visuals.

Mobile already did all of this; **reuse its logic** (don't reinvent):
- `app/src/lib/supabase.ts` — client setup (URL + anon key)
- `app/src/lib/auth.tsx` — signUp / signIn / signOut
- `app/src/lib/profile.tsx` — display name, club lofts, prefs, change password, delete
- `app/src/lib/dataStore.tsx` — load user's shots+sessions, compute clubs
- `app/src/lib/clubData.ts` — `computeClubs(rawShots)` (port of generate_trajectories.py)
- `supabase/schema.sql` — tables (profiles/sessions/shots) + RLS
- `supabase/functions/delete-account/` — account deletion edge function (deployed)

## Backend facts (already live — do not rebuild)
- Supabase project ref `uzqtotiilluwktewdlmr` · URL `https://uzqtotiilluwktewdlmr.supabase.co`
- Anon/publishable key is **safe to embed in web JS** (RLS protects data). It's in
  `app/.env` (EXPO_PUBLIC_SUPABASE_ANON_KEY) — use the same value in the web.
- Tables + RLS already enforce per-user isolation. Email confirmation OFF (dev).
- Test/demo account: `demo@abshermetrics.com` (seeded with 5 sessions / 242 shots).

## Plan (phases)
- **Phase 0 — consolidate (DONE in this commit):** merge `native-app` → `main` so web +
  mobile + backend live in one repo. Web app files are UNCHANGED by the merge.
- **Web work goes on a feature branch** `web-multiuser` off `main`, merged back to
  `main` per stable phase (main auto-deploys to Render — never push half-built auth to main).
- **Phase 1 — Auth (DONE — branch `web-multiuser`):** `@supabase/supabase-js@2`
  loaded from `https://esm.sh`. Files added at repo root:
  - `auth.js` — ESM module: supabase client (publishable key embedded; safe, RLS),
    `guard()` (redirect-if-signed-out, returns session), `signIn/signUp/signOut`,
    `displayNameOf`. localStorage session, storageKey `am-auth`.
  - `auth-gate.js` — side-effecting module each page imports: runs `guard()`, reveals
    the page, mounts a "Signed in <name> · Sign out" chip into the existing `.nav`.
  - `login.html` — on-brand sign-in / create-account screen. Honors `?next=` with an
    open-redirect guard (unit-tested); bounces already-signed-in users to `next`.
  - Gate block injected in `<head>` of the 7 app pages (index, club-detail, trends,
    top-down, flight-3d, raw-data, model). `login.html` + `privacy.html` stay public.
  - Verified in-browser: logged-out→login redirect, sign-in→chip, login bounce, sign-out.
  - NOTE: pages still load the bundled `shots.json` (Spencer's data) until Phase 2.
    **Do not merge to `main` yet** — gating the live site while it still shows one
    person's data is incoherent. Merge after Phase 2 (login → your own data).
- **Phase 2 — Per-user data:** replace bundled `shots.json`/`raw-shots.json` loading
  with the signed-in user's shots from Supabase, computed on the fly via the shared
  `flight-engine.js` + a JS port/reuse of `computeClubs` (clubData.ts logic). Each
  page (index/trends/club-detail/flight-3d/raw-data/top-down) needs its data source
  swapped to this shared loader.
- **Phase 3 — Settings + upload:** clubs/lofts editor, change password, delete account
  (call the `delete-account` function), and CSV upload → Supabase, on the web.
- **Keep/enhance** the web's 3D visuals as the premium view.

## Key technical decisions / notes
- Web is vanilla HTML/JS (no framework/bundler). Load supabase-js via ESM CDN in a
  `<script type="module">`, or a small shared module included on every page.
- Build ONE shared web module (auth + supabase client + per-user data loader +
  computeClubs) and include it on each HTML page, rather than duplicating per page.
- Investigate first (Phase 2 start): grep each web HTML for how it currently reads
  `shots.json` / `raw-shots.json` and where to inject the per-user data.
- Render deploys `main` (static site at repo root). Adding `app/`, `supabase/` dirs
  doesn't affect the web deploy. Only merge to `main` when a phase is stable.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## Where to resume after compaction
1. Read this file + `HANDOFF_MOBILE.md` + `RELEASE.md`.
2. `git checkout web-multiuser` (Phase 1 lives here; NOT yet merged to `main`).
3. Start **Phase 2 (Per-user data)** — see below.
4. Reference the mobile `app/src/lib/*` files for the exact auth/data/profile logic.

## Phase 2 plan (per-user data) — NEXT
Replace bundled `shots.json` / `raw-shots.json` loading with the signed-in user's
shots from Supabase, computed on the fly. Concretely:
- Build a shared web module `user-data.js` (root) that, given the session:
  - fetches the user's `sessions` + `shots` from Supabase (same queries as mobile
    `dataStore.tsx`), then
  - computes the per-club `ClubData[]` (the shape `shots.json` provides) via a JS port
    of `app/src/lib/clubData.ts` `computeClubs()` — which calls the shared root
    `flight-engine.js` (`simulateFlight`). Port `mean`/`sd` too (mobile `@/lib/format`).
  - also exposes the raw shots + sessions (the shape `raw-shots.json` provides) for
    `raw-data.html` / `top-down.html`.
- Each page currently does `fetch('shots.json')` or `fetch('raw-shots.json')`. Swap
  those for the shared loader (auth-gate already guarantees a session exists). Pages
  using shots.json: index, club-detail, trends, top-down, flight-3d, raw-data
  (grep `fetch(` confirmed). model.html has no data fetch.
- Empty state: a new user has 0 shots → show a "no data yet / upload or load sample"
  message instead of a broken page. (Mobile's index empty state is the reference.)
- Keep the web's richer 3D/2D visuals intact — only the DATA SOURCE changes.
- After Phase 2 is stable + verified in-browser, MERGE `web-multiuser` → `main`
  (now coherent: login → your own data). Phase 3 (settings/upload) can follow.

## Release pipeline (already set up — see RELEASE.md)
- Mobile: `npm run ota` (JS OTA, instant) / `npm run release` (build+submit both stores).
- iOS submit fully headless (ASC API key). Android submit needs `app/google-play-key.json`.
- Web: deploys via Render on push to `main`.
