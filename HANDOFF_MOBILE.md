# AbsherMetrics — Mobile App Handoff (native-app branch)

Resume point for the native (iOS/Android) app + multi-user backend. The original
web-app handoff is `HANDOFF.md`; this doc covers the Expo app and Supabase work.

## Big picture
- Goal: turn the static web app into a **multi-user mobile app** (Android first → Play Store).
- **Branch `native-app`** (off `main`). `main` = the web app, deployed on Render at
  abshermetrics.com — DO NOT merge native work into `main` (only `privacy.html`, see below).
- Git remote is **SSH**; commit to `native-app`, end commit messages with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Latest commit: `d1ff074`.
- The app lives in **`app/`** — Expo SDK 56, React Native 0.85, expo-router (tabs), TypeScript.

## Run / build / test
- Dev: `cd app && npm run start`, open the installed **dev build** on the phone (Galaxy Z Fold 7).
- **JS changes → just reload** (shake → Reload). **Rebuild only for native changes**
  (icon/splash, orientation/app.json, or adding a native module): `npx eas-cli build -p android --profile development`.
- EAS: account **3sigma**, projectId `9cc29243-958f-4474-9ff5-50222a2679bf`. Profiles in `app/eas.json` (development = internal APK; production exists).
- Verify gate: **`cd app && npx tsc --noEmit`** must be clean. Bundle check: `npx expo export --platform android`.
- Web preview (`.claude/launch.json`, port 19010) only works when the user's Metro (8081) is OFF — dual Metro conflicts, so usually rely on tsc + on-device.
- No rebuild needed for: Supabase/auth/data/Settings (all JS/server). Rebuild needed for: the new app icon/splash (committed, not yet in a build), orientation.

## Architecture
### Shared engine + data
- `app/scripts/sync-shared.js` copies repo-root `flight-engine.js`, `shots.json`,
  `raw-shots.json` → `app/src/shared/` (COMMITTED generated copies; runs pre start/ios/android/web/export and on install). Repo root stays the editable source.
- `@/engine` (`app/src/engine.ts`) = typed facade over `src/shared/flight-engine.js` (simulateFlight, attributeCarryChange, etc.).
- `@/lib/clubData.ts`: `computeClubs(rawShots) -> ClubData[]` — JS port of `generate_trajectories.py`, computes carry/total/apex/ell/mean/shots/roll/derived on-device. Also `CLUB_ORDER`, `CLUB_COLORS`, `DEFAULT_LOFTS`. Verified to reproduce shots.json.
- `@/lib/dataStore.tsx`: **DataProvider** + **useClubs()** / **useRawData()** — load the signed-in user's shots+sessions from Supabase, compute clubs. Same shapes the screens use.
- `@/data` (default `CLUBS`) and `@/rawData` (getRawData) are now LEGACY: screens import only their TYPES; the bundled JSON still gets imported by those modules but the app reads per-user data via the hooks. (Could be slimmed later.)

### Auth + profile
- `@/lib/supabase.ts`: client; keys from `app/.env` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` = publishable key). `.env` is git-ignored.
- `@/lib/auth.tsx`: AuthProvider + useAuth (signUp/signIn/signOut, email+password).
- `@/lib/profile.tsx`: ProfileProvider + useProfile — display_name, club_specs (per-club loft + inBag), prefs (reduceMotion); helpers getLoft/inBag; updateName/saveClubSpecs/updatePrefs/changePassword.
- `_layout.tsx`: providers nested AuthProvider > ProfileProvider > DataProvider. **AuthOverlay** gates the app (spinner → SignInScreen → app). Header titles blanked (`headerTitle: () => null`); a **gear** (headerRight) → `/settings`. Each screen keeps its in-screen hero title.

### Screens (`app/src/app/`)
index (Bag), club-detail (Clubs), trends, dispersion (2D), flight-3d (3D), raw-data (Raw),
model (hidden, linked from Bag), settings (hidden, via gear). Tab labels via `title`; icons = MaterialCommunityIcons tinted by tab color. All read per-user data with loading/empty states.
- **3D**: pure react-native-svg orthographic 3D (NOT expo-gl — that crashes on SDK 56 New Arch). Orbit (drag)/zoom (pinch)/pan (2-finger), Launch animation + mph HUD, Show mean/shots, All/None + club chips, roll-out always on. Landscape supported via `expo-screen-orientation` (unlock on focus, portrait on blur; header hidden in landscape; scene fills, controls in a side panel).
- **Club Detail**: includes `@/components/AverageShot.tsx` (animated side+top views; respects reduceMotion; stacks vertically on narrow screens).
- **Settings**: Account (name, email, change password, sign out, **Delete account**), My Clubs (loft + in-bag per club → saved to profiles.club_specs; lofts feed the Bag table), App (Reduce motion).

## Supabase (project ref `uzqtotiilluwktewdlmr`)
- URL: https://uzqtotiilluwktewdlmr.supabase.co
- Tables (in `supabase/schema.sql`, run in SQL Editor): `profiles`, `sessions`, `shots`,
  all with **Row-Level Security** (each user only their own rows). `handle_new_user` trigger
  auto-creates a profile on signup. Email confirmation is **OFF** (dev).
- Added columns: `profiles.club_specs jsonb`, `profiles.prefs jsonb`.
- **Edge function `delete-account`** (`supabase/functions/delete-account/index.ts`): DEPLOYED + verified — deletes the auth user (cascades to all data). App calls `supabase.functions.invoke('delete-account')`.
- Seed script `app/scripts/seed-my-data.mjs`: loads repo-root raw-shots.json into an account (`cd app && SEED_EMAIL=.. SEED_PASSWORD=.. node scripts/seed-my-data.mjs`).
- **Test account**: `spencer.absher@gmail.com` — seeded with 5 sessions / 242 raw shots (234 modeled, 8 excluded). NOTE: its password was shared in chat → should be changed.

## Status by phase
- **Phase 1 (done):** Supabase schema + RLS + auth foundation.
- **Phase 2 (done):** auth gating + sign-in/up; per-user data (read from Supabase, compute on-device); CSV upload → cloud; empty/loading states.
- **Extras (done):** Settings menu; removed redundant nav-header titles (kept in-screen heroes); branded tab icons; landscape 3D; phone-fit Average Shot.
- **Phase 3 (done):** account deletion (deployed + verified); privacy policy written; app icon/splash branded (in repo; appears after next build).

## IMMEDIATE next steps (before/into Phase 4)
1. **Publish `privacy.html` to `main`** so it's live at abshermetrics.com/privacy.html (Render serves `main`). Do it via a `git worktree` so it doesn't disturb the `native-app` checkout / running dev server. (Required for the Play listing + Data Safety + deletion URL — the `#deletion` anchor.)
2. **Confirm the two ALTERs ran** in Supabase (`club_specs`, `prefs` columns) — needed for Settings to save lofts/prefs. (Test: Settings → set a loft → Save → "Clubs saved".)
3. **Phase 4 — Play Store:**
   - EAS **production build** (Android App Bundle): `npx eas-cli build -p android --profile production` (will include the new icon/splash).
   - Provide the `EXPO_PUBLIC_*` env vars to the EAS build (eas.json env or EAS env vars) — production build won't read local `.env`.
   - **Play Console** ($25 one-time): create app, store listing (title/short+long desc/screenshots/feature graphic), content rating questionnaire, **Data Safety** (declare: email + golf shot data; not shared; not sold; deletable in-app + via privacy URL), upload AAB → internal testing → production.

## Conventions / gotchas
- Adding a NEW native module → new dev build required (e.g., expo-gl was abandoned for SVG to avoid that crash). Pure-JS deps (supabase-js, svg... already in) need only a Metro restart.
- `app/.env` holds the Supabase keys (git-ignored; anon/publishable key is safe to ship — RLS protects data).
- Keychain: the Supabase CLI deploy from a non-interactive shell triggers a macOS keychain prompt; deploy via the dashboard or the user's own terminal instead.
- Optional cleanups: slim the legacy `@/data`/`@/rawData` bundled-JSON usage now that data is per-user; remove leftover Expo-template assets/components.
