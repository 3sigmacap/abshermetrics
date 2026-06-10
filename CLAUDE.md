# AbsherMetrics — project memory

A golf launch-monitor analysis app shipped on three platforms that share one backend.

## ▶ ACTIVE PROJECT: Connections & Compare (Phases A+B done; Phase C next)
Full approved spec + status in **`CONNECTIONS_PLAN.md`**. Read it first.
Players link by email ("connections", mutual), share **Bag summary + avg trajectory
only** (never raw shots), and **Compare** (overlay + deltas via a button on the Bag).
Built on the `connections` branch off `main`, web + mobile in lockstep, Phases A–E.
- **Phase A (link by email) + Phase B (publish/view bag summary): DONE, merged to main.**
  Backend (connections + bag_summaries tables, RLS, are_connected/user_id_by_email,
  request-connection Edge Function) is **live on Supabase + verified** (RLS isolation +
  upsert tested with real users). Web is live; mobile rides the next native build.
- **Next: Phase C — Compare** (gapping-ladder overlay + per-club delta table + avg-shot
  trajectory overlay) via a "Compare with a connection" button on the Bag.

## ⭐ STANDING RULE: keep web + mobile in lockstep
**Apply EVERY user-facing change (UI, feature, layout, copy) to BOTH the web app AND
the mobile app by default** — unless the user explicitly scopes it to one platform.
When you make such a change, do it in both places and say so in your reply
("applied to web + mobile"). If a request is ambiguous, default to both.

Why this is a rule and not automatic: the **screens are two separate codebases** in
different languages, so a change in one does NOT propagate to the other on its own.
They drifted apart once before; this rule prevents that.

## Architecture (what's shared vs. duplicated)
- **Shared — change once, all three platforms get it:**
  - **Supabase** backend: accounts, Postgres tables, Row-Level Security, auth.
    (`supabase/schema.sql`, `supabase/functions/`). Anon/publishable key is safe to
    ship; the service_role/secret key must NEVER be in any client.
  - **Physics engine + math:** `flight-engine.js` (repo root) is the single source of
    truth. Web imports it directly; mobile auto-syncs a copy via
    `app/scripts/sync-shared.js` on build. The web's `club-compute.js` mirrors the
    mobile `app/src/lib/clubData.ts` (computeClubs) — keep them numerically identical.
- **Duplicated — must be edited in BOTH for parity:**
  - **Web frontend** = vanilla HTML/JS at the repo root (`index.html`,
    `club-detail.html`, `trends.html`, `top-down.html`, `flight-3d.html`,
    `raw-data.html`, `settings.html`, `login.html`, `model.html`, plus shared modules
    `auth.js`, `auth-gate.js`, `user-data.js`, `club-compute.js`, `profile.js`,
    `empty-state.js`). No bundler; ES modules loaded from the root; supabase-js via esm.sh.
  - **Mobile frontend** = Expo / React Native under `app/src/` (`app/index.tsx`,
    `club-detail.tsx`, `trends.tsx`, `dispersion.tsx`, `flight-3d.tsx`, `settings.tsx`,
    `raw-data.tsx`, `model.tsx`; libs in `app/src/lib/`). **Mobile is the reference
    for structure/placement** (it shipped first). The web pages are JS ports of these.
    The web MAY be visually richer (it's the "better 3D visuals" platform) but the
    navigation structure and which screen holds which content must match mobile.

## Delivery (Claude runs these; user never builds/deploys — see RELEASE.md)
- **Web:** merge to `main` → Render auto-deploys (~2 min). Develop on a feature branch.
- **Mobile JS change:** `cd app && npm run ota` — live in seconds, no store review.
- **Mobile native change / version bump:** `cd app && npm run release` — store review applies.

## Key facts / constraints
- Web requires login (gated); one Supabase account works across web/iOS/Android.
- Demo account: `demo@abshermetrics.com` (seeded sample data) — keep it pristine for
  App Store/Play reviewers; don't leave test data on it.
- Resume docs: `WEB_MULTIUSER.md` (web multi-user build), `HANDOFF_MOBILE.md` (mobile),
  `RELEASE.md` (pipeline), `APP_STORE.md` / `PLAY_STORE.md` (submission packs).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
