# AbsherMetrics

**The physics behind every yard.**

Golf launch-monitor analysis on **web, iOS, and Android** — one account, your data
everywhere. Your launch monitor (Garmin Approach R50) measures only the moment of
impact: ball speed, launch angle, spin. AbsherMetrics integrates the full physics of
ball flight from those numbers — carry, apex, descent, dispersion, roll — and renders
it as tables, 2D dispersion, and interactive 3D trajectories.

🔗 **Live:** https://abshermetrics.com · iOS App Store + Google Play (1.0.0)

---

## What it does
- **Your bag, by the numbers** — per-club carry, total, gapping, launch, spin, apex.
- **Club detail** — distribution, dispersion, consistency, an animated engine-computed
  "average shot" (side profile + top-down), and every raw shot.
- **Trends** — session-over-session change with a physics-based carry-attribution
  (how much of a carry change came from speed vs. launch vs. spin).
- **2D dispersion** — true 1:1 top-down + side profile with 1σ ellipses.
- **3D flight** — orbit the real fitted trajectories for every club.
- **Accounts** — sign in on any platform; upload your own R50 CSVs; manage your bag
  (lofts, in-bag), change password, delete account. New users can load sample data.

## Architecture — one backend, one engine, tailored frontends

```
                ┌─────────────────────────────────────────────┐
                │  Supabase  (Postgres + Row-Level Security +   │
                │  Auth + Edge Functions)   ← shared backend    │
                └───────────────▲───────────────▲──────────────┘
                                │               │
          ┌─────────────────────┘               └────────────────────┐
   flight-engine.js  (drag + Magnus physics)  ← shared, single source │
          │                                                           │
 ┌────────┴─────────┐   ┌─────────────────────────────────────────────┐
 │   Web app        │   │   iOS app          +      Android app        │
 │ vanilla HTML/JS  │   │   Expo / React Native  (one codebase, app/)  │
 │ (repo root)      │   │                                              │
 │ richer 3D / 2D   │   │   quick stats on the go                      │
 └──────────────────┘   └──────────────────────────────────────────────┘
```

- **Shared (change once, all platforms get it):** the Supabase backend and the
  `flight-engine.js` physics engine + club/trajectory math. The web imports the
  engine directly; the mobile build auto-syncs a copy.
- **Duplicated by design:** the **screens** are two separate codebases — the web is
  vanilla HTML/JS, mobile is React Native. They behave the same but are edited in
  both places to stay in parity (mobile is the structural reference; the web is the
  "better visuals" platform). See [`CLAUDE.md`](CLAUDE.md).

## Repository layout
```
/                      Web app (static, no build step) — served by Render from main
  index.html             Bag · club-detail · trends · top-down (2D) · flight-3d · raw-data
  settings.html          login.html · model.html · privacy.html
  auth.js auth-gate.js   Supabase client, login gate, account chip
  user-data.js           per-user load / CSV upload / sample / delete (ports dataStore)
  club-compute.js        computeClubs() — bit-identical port of the mobile/Python model
  profile.js             name / lofts / prefs / password / delete-account
  empty-state.js         shared loading / empty / error UI
  flight-engine.js       ⭐ the physics engine (single source of truth)
app/                   Mobile app — Expo / React Native (iOS + Android)
  src/app/*.tsx          screens   src/lib/*.tsx   data/auth/profile
supabase/              schema.sql (tables + RLS) · functions/ (delete-account)
store/                 store icons / feature graphics / screenshots
```

## Tech stack
- **Web:** vanilla HTML + ES modules (no bundler); `@supabase/supabase-js` via the
  esm.sh CDN; Three.js for 3D; SVG for 2D/charts.
- **Mobile:** Expo SDK 56 · React Native 0.85 · expo-router · TypeScript · EAS
  Build/Submit/Update.
- **Backend:** Supabase (Postgres, Row-Level Security, Auth, Edge Functions).
- **Physics:** `flight-engine.js` — a dependency-free JS port of the aerial-phase
  aerodynamics in [libgolf](https://github.com/gdifiore/libgolf) (after Prof. Alan M.
  Nathan), plus bounce + roll. Same engine runs in the browser and on mobile.

## Local development
**Web** (no build step):
```bash
python3 -m http.server 8000
# open http://localhost:8000   (must be http://, not file://)
```
**Mobile:**
```bash
cd app && npm install && npm run ios   # or: npm run android / npm run web
```

## Deployment (no manual build/compile/upload)
- **Web** → push to `main`; Render auto-deploys the static site (~2 min).
- **Mobile, JS-only change** → `cd app && npm run ota` (EAS Update — live in seconds,
  no store review).
- **Mobile, native change / version bump** → `cd app && npm run release` (EAS builds
  iOS + Android and auto-submits; store review applies).

See [`RELEASE.md`](RELEASE.md) for the full pipeline.

## Security
- The Supabase **publishable (anon) key is safe to ship** — Row-Level Security scopes
  every row to its owner, and it's the same key in the public mobile bundle. The
  **service_role / secret key must never appear in any client.**
- The web requires login; user uploads and writes are parameterized (no SQL/HTML
  injection) and stamped with `user_id` under RLS.

## Documentation
| Doc | What |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Project memory + the **web⇄mobile parity rule** |
| [`WEB_MULTIUSER.md`](WEB_MULTIUSER.md) | How the web became multi-user |
| [`HANDOFF_MOBILE.md`](HANDOFF_MOBILE.md) | Mobile app build/submission notes |
| [`RELEASE.md`](RELEASE.md) | Request → live pipeline (web deploy + mobile OTA/release) |
| [`APP_STORE.md`](APP_STORE.md) / [`PLAY_STORE.md`](PLAY_STORE.md) | Store submission packs |

A deeper guide lives in the [project Wiki](../../wiki).
