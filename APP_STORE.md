# AbsherMetrics — Apple App Store submission pack

Everything for the App Store Connect listing. Bundle ID **com.abshermetrics.app**,
EAS project `@3sigma/abshermetrics`. iPhone-only (supportsTablet=false).

---

## 0. Build + submit (headless — Claude runs these)
Signing is set up on EAS (distribution cert + provisioning profile). API key in
`eas.json` (`submit.production.ios`, key `./appstore-api-key.p8`, git-ignored).

```
# build (already auto-increments buildNumber via appVersionSource: remote)
EXPO_ASC_API_KEY_PATH=... EXPO_ASC_KEY_ID=B9DKR3PSS8 EXPO_ASC_ISSUER_ID=... \
  npx eas-cli build -p ios --profile production
# submit the latest build to App Store Connect / TestFlight
npx eas-cli submit -p ios --latest
```
`eas submit` creates the App Store Connect app record automatically if missing.

---

## 1. App information (App Store Connect → your app → App Information)
- **Name (≤30):** `AbsherMetrics`
- **Subtitle (≤30):** `Know why your carry changed`
- **Category:** Primary **Sports** · Secondary **Health & Fitness** (optional)
- **Privacy Policy URL:** https://abshermetrics.com/privacy.html
- **Content rights:** does not use third-party content → No.

## 2. Version listing (Pricing: Free)
**Promotional text (≤170, editable anytime without review):**
```
See not just what your launch-monitor numbers are, but WHY they changed — a real
ball-flight physics model breaks every carry change into ball speed, launch, spin.
```

**Description (≤4000):**
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
- Performance Analytics — compare any set of sessions and watch carry, launch, spin, and ball
  speed move over time, with the physics-based attribution of every carry change.
- Your bag at a glance — carry, total, apex, ball speed, and loft for every club.
- Per-club detail — an animated "average shot" from the side and top down.
- 2D dispersion — your shot pattern and consistency for each club.
- Interactive 3D ball flight — orbit, zoom, and pan a true-to-physics trajectory.
- Raw data — every shot in a sortable table, filterable by session.

CONNECT & COMPARE
- Link up with other players by email, then compare bags side by side — a gapping
  ladder, per-club carry and total gaps, and your average ball flight overlaid on
  theirs. You share only your aggregate bag summary; your individual shots are never
  shared. Get a notification when someone wants to connect.

BUILT ON REAL PHYSICS
- Upload a CSV from your launch monitor; your whole bag is computed on-device.
- Set your clubs and lofts once; the app uses them everywhere.

PRIVATE BY DESIGN
- Your account and shots are yours alone (database row-level security).
- Connections see only your aggregate bag summary — never your individual shots.
- No ads. No third-party analytics. We don't sell or share your data.
- Delete your account and all your data anytime, instantly, in the app.

Stop guessing why you hit it shorter today. AbsherMetrics tells you why.
```

**Keywords (≤100 chars, comma-separated, no spaces):**
```
golf,launch monitor,garmin,r50,dispersion,carry,spin,ball flight,range,trends,gapping
```

**Support URL:** https://abshermetrics.com   ·   **Marketing URL (optional):** https://abshermetrics.com

## 3. Screenshots (iPhone-only)
Required: **6.9"** display (1320×2868). One set covers all iPhones.
- No iPhone? Capture in the **iOS Simulator** on your Mac (Xcode required) — a
  simulator build needs no Apple membership. Use an iPhone 16 Pro Max simulator,
  load the demo account, and File → Save Screen (⌘S). Claude can produce a
  simulator build and walk you through it.
- Shots: Bag (with sample data), Club detail, 3D ball flight, Dispersion, Performance Analytics.

## 4. App Privacy (App Store Connect → App Privacy)
"Does this app collect data?" → **Yes**. None used for **tracking**. No third-party sharing.

| Data type (Apple category) | Linked to user | Tracking | Purpose |
|---|---|---|---|
| **Contact Info → Email Address** | Yes | No | App Functionality |
| **User Content → Other User Content** (golf shot/session data) | Yes | No | App Functionality |

Explicitly NOT collected: location, contacts, identifiers/ad data, usage/analytics,
diagnostics tied to identity, financial, browsing. No tracking, no data broker.

**Connections (user-to-user):** if you accept a connection, that player can see your
name, email, and **aggregate bag summary** (never your raw shots). This is sharing
between app users you choose — not third-party sharing. iOS push notifications are
used for connection requests/accepts (APNs key configured on the build).

## 5. App Review Information
- **Sign-in required:** Yes → provide the demo account:
  - **Username:** `demo@abshermetrics.com`
  - **Password:** `AbsherDemo2026!`
- **Notes:** "Sign in with the demo account; it's pre-loaded with sample golf
  launch-monitor data (5 sessions, 242 shots) so every screen renders. The app
  ingests CSV exports from a Garmin Approach R50 launch monitor; testers without
  one can tap 'Load sample data' on a new empty account.
  To test Connections: create a second account, then from Settings → Connections add
  it by email; accept from the other side; each side can then tap 'Compare with a
  connection' on the Bag. Sharing is **aggregate only** (per-club averages + an
  average trajectory) — there is no free-text or user-generated content, and either
  party can remove the connection at any time."
- **Contact:** your name / email / phone.

## 6. Compliance / gotchas (already handled or noted)
- **Export compliance:** app.json sets `ITSAppUsesNonExemptEncryption=false`
  (standard HTTPS only) → no encryption prompt each submit.
- **Account deletion:** required by Apple (5.1.1(v)) — present in Settings → Delete account. ✅
- **Sign in with Apple:** NOT required (email/password only; no third-party logins). ✅
- **Demo data:** "Load sample data" button covers reviewers/testers without an R50.

## 7. Release flow
EAS build → `eas submit -p ios --latest` → build appears in **TestFlight**
(optional internal testing, NO 12-tester/14-day rule like Google) → fill the
listing above → **Submit for Review** → Apple review ~24–48h → release.

## Quick reference
- Privacy policy: https://abshermetrics.com/privacy.html (deletion: …#deletion)
- ASC API key id `B9DKR3PSS8`, issuer `9fbb029e-05c2-4769-8630-67d6624232c5` (.p8 git-ignored)
- Demo: demo@abshermetrics.com / AbsherDemo2026!
