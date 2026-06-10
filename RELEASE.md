# Release pipeline — request → live, hands-off

Goal: you ask for a change here; it ships to both stores with **no build/compile/
delivery work from you**. There are two paths. Claude runs these; this doc is the map.

## Path 1 — OTA update (JS/content changes) → live in SECONDS, no review
Use for: logic, screens, copy, styling, bug fixes — anything that doesn't add a
**native** module or change native config. This is ~90% of changes.

```
cd app && npm run ota         # = eas update --branch production
```
- Pushes a new JS bundle to the "production" channel.
- Every installed app on the same **runtimeVersion** (= app version, e.g. 1.0.0)
  downloads it on next launch. **No rebuild, no App Store / Play submission, no review.**
- Apple & Google both permit Expo OTA JS updates.
- Requires the live store build to contain `expo-updates` (configured here). The
  FIRST store build that includes it is the gate — after that, OTA is instant forever.

## Path 2 — Native release (build + submit both stores) → store review applies
Use for: a new native dependency, app icon/splash, permissions, orientation, an
`app.json` native change, or a marketing version bump (1.0.0 → 1.1.0).

```
cd app && npm run release     # eas build -p all --profile production --auto-submit
```
- Builds iOS + Android in the cloud, then **auto-submits** to App Store Connect +
  Google Play (using the stored credentials).
- iOS auto-submit: ready (App Store Connect API key, `appstore-api-key.p8`).
- Android auto-submit: needs `app/google-play-key.json` (see below).
- **Store review is mandatory and outside our control:** Apple ~1–2 days; Google
  review + (for now) the closed-testing 12-tester / 14-day gate. No tool skips this.
- Single platform: `npm run release:ios` / `npm run release:android`.

## Deciding which path (Claude does this automatically)
| Change | Path |
|---|---|
| JS logic, UI, copy, charts, fixes | **OTA** (`npm run ota`) — seconds |
| New native module, icon, splash, permissions, app.json native keys | **Native release** (`npm run release`) — store review |
| Marketing version bump | Native release |

If unsure, the safe default is a native release; OTA only works when the native
layer (runtimeVersion) is unchanged.

## Credentials status
- **iOS:** App Store Connect API key `appstore-api-key.p8` (git-ignored). Build +
  submit are fully headless. Apple Team `9NQTUNK2Y5`, ASC app id `6778607525`.
- **Android:** needs a Google Play **service-account JSON** at `app/google-play-key.json`
  (git-ignored, referenced by `eas.json` submit.production.android). One-time setup:
  Play Console → Setup → API access → create/link a Google Cloud service account →
  download its JSON key → Play Console → Users & permissions → grant it "Release to
  testing tracks" (+ production) → save the file. Guide: https://docs.expo.dev/submit/android/

## How EAS Update is wired
- `app.json`: `updates.url` → EAS, `runtimeVersion.policy = appVersion`.
- `eas.json`: each build profile has a `channel` (production build → `production` channel).
- A native release bumps the version → new runtimeVersion → that release's installs
  then receive OTA updates published to `production`.

## Notes
- `preota` runs `sync-shared` first, so OTA bundles never ship stale engine/data copies.
- EAS build runs `sync-shared` via `postinstall` on the server, so native builds are
  always in sync too.
- Optional future upgrade: connect the GitHub repo to EAS Workflows so a push can
  trigger build+submit automatically — not required, since Claude runs these on request.
