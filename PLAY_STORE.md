# AbsherMetrics — Google Play submission pack

Everything needed to fill out the Play Console listing. Copy-paste ready.
Package: **com.abshermetrics.app** · Version: **1.0.0** · EAS project `@3sigma/abshermetrics`.

---

## 0. Build the release artifact (AAB)
Run in YOUR terminal (it will ask to generate an upload keystore — answer **Yes**;
EAS stores and reuses it for every future release):

```
cd app
npx eas-cli build -p android --profile production
```

- Output: an **.aab** (Android App Bundle) — this is what Play wants.
- The build pulls `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` from
  EAS env vars (already set for the `production` environment), and includes the new
  icon/splash.
- versionCode is managed remotely by EAS (`appVersionSource: remote`, `autoIncrement`),
  so the first release is versionCode 1 and bumps automatically each build.
- When the build finishes, download the `.aab` from the EAS build page (or `eas build:list`).

---

## 1. Create the app in Play Console
- **Play Console** ($25 one-time developer registration if you don't have an account): https://play.google.com/console
- Create app → App name: **AbsherMetrics** · Default language: English (US) · App type: **App** · **Free**.
- Declarations: it's not a game; you agree to the Play policies + US export laws.

---

## 2. Store listing

**App name** (≤30 chars)
```
AbsherMetrics
```

**Short description** (≤80 chars)
```
Why did your carry change? Golf analytics powered by a real ball-flight model.
```

**Full description** (≤4000 chars)
```
Most golf apps show you WHAT your numbers are. AbsherMetrics shows you WHY they
changed.

Upload your launch-monitor data and AbsherMetrics runs a real ball-flight physics
model on your shots — turning raw numbers into answers, not just charts.

WHY DID MY CARRY CHANGE? (the insight no other app gives you)
When your carry moves from one range session to the next, AbsherMetrics breaks the
change down to its true causes. Pick any two sessions and the physics model
attributes the yardage difference across the three things that actually move the
ball — ball speed, launch angle, and spin. So you don't just see that your 7-iron
lost 5 yards; you see that 4 of them came from slower ball speed and 1 from added
spin. That's a diagnosis of your game, not just a dashboard.

POWERFUL ANALYTICS
• Trends — compare any set of sessions and watch carry, launch, spin, and ball
  speed move over time, with the physics-based attribution of every carry change.
• Your bag at a glance — carry, total, apex, ball speed, and loft for every club.
• Per-club detail — an animated "average shot" from the side and top down.
• 2D dispersion — your shot pattern and consistency for each club.
• Interactive 3D ball flight — orbit, zoom, and pan a true-to-physics trajectory;
  tap Launch to watch the shot fly. Full-screen in landscape.
• Raw data — every shot in a sortable table, filterable by session.

BUILT ON REAL PHYSICS
• Upload a CSV from your launch monitor; your whole bag is computed on-device with
  the same ball-flight model used to simulate the trajectories — no guesswork, no
  canned animations.
• Set your clubs and lofts once; the app uses them everywhere.

PRIVATE BY DESIGN
• Your account and shots are yours alone, protected by database row-level security.
• No ads. No third-party analytics. We don't sell or share your data.
• Delete your account and all your data anytime, instantly, right in the app.

Stop guessing why you hit it shorter today. AbsherMetrics tells you why.
```

**App category:** Sports
**Tags:** golf, sports, fitness
**Contact email:** spencer.absher@gmail.com
**Privacy policy URL:** https://abshermetrics.com/privacy.html

### Graphic assets required by Play
- **App icon:** 512×512 PNG — derive from `app/assets/images/icon.png` (it's 1024; downscale to 512). (`favicon.png` is already 512 and is the same mark.)
- **Feature graphic:** 1024×500 PNG — *(ask Claude to generate one — branded lime "AbsherMetrics" on dark.)*
- **Phone screenshots:** 2–8 required. Capture on the phone (dev build is fine):
  Bag, Club detail (average shot), 3D flight (portrait + landscape), Dispersion, Trends.
  PNG/JPG, 16:9 or 9:16, each side 320–3840 px.

---

## 3. Data Safety form (App content → Data safety)
Answer exactly:

- **Does your app collect or share any of the required user data types?** → **Yes** (collect; no sharing).
- **Is all user data encrypted in transit?** → **Yes**.
- **Do you provide a way for users to request that their data be deleted?** → **Yes**
  → Deletion URL: `https://abshermetrics.com/privacy.html#deletion`

**Data types collected**

| Category | Type | Collected | Shared | Optional? | Purpose | Ephemeral? |
|---|---|---|---|---|---|---|
| Personal info | Email address | Yes | No | Required | Account management, App functionality | No |
| Health and fitness | Fitness info (your golf shot/session metrics) | Yes | No | Required | App functionality | No |

Notes for the reviewer's questions:
- Email is collected for sign-in/account (Supabase Auth).
- "Fitness info" = the shot/session data you upload or enter (ball speed, launch,
  spin, carry, etc.) and your club settings. Core app functionality.
- **No** location, contacts, financial info, photos, messages, device IDs, or
  advertising data. **No** data shared with third parties. **No** ads/analytics SDKs.
- Data processing: stored on the developer's behalf by Supabase (hosted Postgres).

---

## 4. App content questionnaires
- **Privacy policy:** https://abshermetrics.com/privacy.html
- **App access:** the app is login-gated, so a reviewer needs a demo login.
  Choose "All or some functionality is restricted" and add a demo credential:
  - Username: `demo@abshermetrics.com` (password kept out of git — paste it from chat / your notes)
  - Pre-seeded with 5 sessions / 242 shots / 11 clubs so all charts render.
  - Instruction text: "Sign in with the email and password below. The account is pre-loaded with sample golf launch-monitor data."
- **Ads:** No, the app does not contain ads.
- **Content rating (IARC):** category "Reference, News, or Educational" (or "Utility");
  answer **No** to all violence / sexual / language / controlled-substance / gambling /
  user-interaction-sharing-location questions → expected rating **Everyone / PEGI 3**.
- **Target audience & content:** target age **18 and over** (not designed for children;
  matches the privacy policy's under-13 statement).
- **Data safety:** see section 3.
- **Government apps / News / COVID / Financial features:** No.
- **Health apps declaration:** if asked, this is a personal fitness/sports tracker
  (no medical claims, not a medical device).

---

## 5. Release (recommended path)
1. **Testing → Internal testing**: create a release, upload the `.aab`, add your
   own email as a tester, install via the opt-in link on the phone, smoke-test
   sign-in / upload / 3D / settings / delete-account.
2. When happy, **Production → Create release**: reuse the same `.aab` (or a fresh
   build), fill the release notes, and roll out. First production review can take
   a few days.

### v1.0.0 release notes (suggested)
```
First release. Track your golf launch-monitor data, see your bag, dispersion,
trends, and an interactive 3D ball flight. Private accounts; delete anytime.
```

---

## Quick reference
- Privacy policy: https://abshermetrics.com/privacy.html  (deletion: …/privacy.html#deletion)
- Supabase project ref: `uzqtotiilluwktewdlmr`
- EAS env vars (production): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` ✓ set
- Build: `cd app && npx eas-cli build -p android --profile production`
