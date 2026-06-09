# Supabase setup (Phase 1)

One-time backend setup so the app can have accounts and per-user shot storage.
You do steps 1–4; the app code is already wired.

## 1. Create the project (free)
1. Go to https://supabase.com → sign up → **New project**.
2. Name it `abshermetrics`, choose a region near you, set a database password (save it).
3. Wait ~2 min for it to provision.

## 2. Create the tables + security
1. In the project: **SQL Editor → New query**.
2. Paste the entire contents of [`supabase/schema.sql`](./schema.sql) and click **Run**.
3. You should see "Success". This creates `profiles`, `sessions`, `shots`, and the
   Row-Level Security policies so each user can only see their own data.

## 3. Turn on email/password auth
1. **Authentication → Sign In / Providers → Email**: make sure **Email** is enabled.
2. For easy testing, **Authentication → Sign In / Providers → Email → "Confirm email"**
   can be turned **off** while developing (so you can log in immediately after signup).
   Turn it back on before launch.

## 4. Put the keys in the app
1. **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
2. In the repo: copy `app/.env.example` to `app/.env`:
   ```bash
   cp app/.env.example app/.env
   ```
3. Edit `app/.env` and paste your values:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
   ```
4. **Restart Metro** (`Ctrl-C`, then `npm run start`) so the new env vars load.

That's it for Phase 1. No new dev build is needed — Supabase is pure JavaScript,
so it loads over Fast Refresh.

## What's next (Phase 2)
With the project live, I'll add the sign-up / sign-in screens, gate the app on
auth, switch the screens to read each user's shots from Supabase (computing
trajectories on-device with flight-engine.js), and move CSV upload to the cloud.

## Notes
- The **anon key is meant to be public** — it ships in the app. Your data is
  protected by Row-Level Security (RLS), not by hiding the key.
- For production/EAS builds, the same two `EXPO_PUBLIC_*` vars must be provided to
  the build (via `eas.json` env or EAS environment variables) — we'll handle that
  in the store-prep phase.
