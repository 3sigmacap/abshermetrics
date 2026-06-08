# AbsherMetrics — Project Handoff

A static golf launch-monitor visualization site for Garmin Approach R50 range data.
Use this doc to resume work in a fresh chat. Attach this doc + the whole site folder
(or the packaged zip). The site is now **physics-engine-driven** — read the ENGINE
section carefully, it's the heart of the project.

## What it is
- **Static site** — plain HTML + JSON + one JS engine module. No build step, no backend, no framework.
- Hosted on **Render.com** via a `render.yaml` blueprint, auto-deploys from a GitHub repo.
- Domain: **abshermetrics.com**. Owner/player: **Spencer**.
- Must be served over **http** (Render, or `python3 -m http.server`), never `file://`, because
  pages `fetch()` JSON and import an ES module.

## Deploy workflow (user does this manually)
Download the files, drop into the local git repo, then:
```
git add -A
git commit -m "..."
git push
```
Render auto-redeploys. Caching gotcha: Render `Cache-Control` + CDN can serve a stale `/` vs
`/index.html`; fix = hard refresh / private tab / Render "Clear build cache & deploy". On mobile,
use a private/incognito tab (no hard-refresh shortcut).

================================================================================
## THE FLIGHT ENGINE — single source of truth (read this first)
================================================================================
`flight-engine.js` is a standalone, documented ES module that simulates golf ball flight.
**Everything modeled on the site comes from it.** It is a faithful JavaScript port of the
aerial + bounce + roll physics in **libgolf** (https://github.com/gdifiore/libgolf) by
Gabriel DiFiore, whose aerodynamics are based on **Prof. Alan M. Nathan** (Univ. of Illinois).
Coefficients are copied verbatim from libgolf's DefaultAerodynamicModel.hpp,
DefaultBounceModel.hpp, DefaultRollModel.hpp, physics_constants.hpp, ShotPhysicsContext.cpp,
DefaultIntegrator.hpp. Full provenance is in the file header. **One documented departure:**
a low-spin drag correction in `computeCd` (the `LOWSPIN_CD_*` params in the AERO block) —
see the validation note below and the comment block in flight-engine.js. It is the ONLY
non-libgolf coefficient in the engine; everything else is still verbatim.

Physics included:
- Aerial: drag + Magnus lift, Reynolds/spin-binned Cd & Cl, semi-implicit Euler, spin decay.
  Full 3D Magnus (spin × velocity) → produces slice/hook curvature from sidespin/axis.
- Bounce: Penner (2003) spin-back + spin/velocity-coupled COR (wedges bite/check).
- Roll: Coulomb friction roll-out to rest (drives release forward, wedges pull back).

Exported functions:
- `simulateFlight(launch, opts)` →
   `{ carryYd, lateralYd, apexFt, descentDeg, flightTime, points,
      totalYd, totalLateralYd, restPoint, groundPoints }`
   `launch`: `{ ballSpeedMph, launchDeg, backspinRpm, sidespinRpm, directionDeg }`
     OR `{ ballSpeedMph, launchDeg, spinRpm, axisDeg, directionDeg }` (auto-split).
   `opts.rollout` (bool): include bounce+roll (adds totalYd/groundPoints). Default false = carry-only.
   `opts.atmos`, `opts.ground`, `opts.ball`, `opts.dt`: optional overrides.
   `points` / `groundPoints` layout: `[x_downrange_yd, height_ft, z_lateral_yd]`.
- `attributeCarryChange(A, B, opts)` → decomposes a carry change (B−A) into how much each
   input drove it (ball speed / launch / spin), via a Shapley split that sums EXACTLY to the
   modeled total. A,B = `{ ballSpeedMph, launchDeg, spinRpm }`. Returns
   `{ carryA, carryB, total, parts:{ballSpeed,launch,spin}, pct:{...} }`. Used by Trends.
- Also exports `BALL`, `STD_ATMOS`, `GROUND`, `normalizeLaunch`.

Validation (cold, against measured R50 carries): ~ +1.1 yd bias / 4.2 yd RMSE across the bag.
Per-club carry bias: SW −4.8, GW −6.6, PW −0.6, 9I +1.7, 8I +4.4, 7I +6.1, 6I +6.8, 5I +4.2,
4I +1.6, 3I +0.4, 3W −1.1. The 3 Wood and 3 Iron USED to under-predict (3W ~−14 yd, 3I ~−3 yd)
because the published Cd fit slightly over-drags in the low-spin-ratio regime (S = ω·r/v below
~0.20: long fairway woods / low-spin drivers). The `LOWSPIN_CD_*` correction (added this session)
fixes both: a smooth, DRAG-ONLY multiplicative Cd reduction that fades in below S=0.20 and
saturates at S=0.06, leaving every club at S≥0.20 (4I through wedges) untouched. It is drag-only
on purpose — adding lift instead fixed carry but ballooned the 3W apex to ~141 ft (unphysical);
drag-only keeps the flat, penetrating low-spin shot shape (3W apex now ~121 ft, matching the R50's
measured ~120). Net effect: 3W 257→270 carry, bag RMSE 5.95→4.2. To retune or revert, edit
`LOWSPIN_CD_GAIN` (0.16), `LOWSPIN_CD_SHI` (0.20), `LOWSPIN_CD_SLO` (0.06) in flight-engine.js's
AERO block, then re-run generate_trajectories.py. Setting GAIN=0 restores the pure libgolf model.

### KEY MODEL DECISION: R50 = launch data only
The R50 gives only LAUNCH data (ball speed, launch angle, launch direction, back/side spin,
total spin, spin axis). **Carry, total, apex, descent, lateral landing are ALL computed by the
engine** — we do NOT use the R50's own carry/apex/total/dev for any modeled output. Those R50
fields are retained inside `shots.json`'s `stats` only so the Raw Data page can show them for
reference/comparison. There is NO "rescale to measured carry" step anywhere anymore
(the old `normalizeCarries()` IIFE was removed from top-down.html and flight-3d.html).

================================================================================
## DATA PIPELINE
================================================================================
`raw-shots.json` (raw R50 launch data) ──► `shots.json` `stats` (cleaned launch rows)
   ──[ generate_trajectories.py runs flight-engine.js ]──► everything else in `shots.json`
   ──► index / club-detail / top-down / flight-3d render it; trends calls the engine live.

### generate_trajectories.py  (THE regen step — re-run after any data change)
Shells out to Node to run flight-engine.js per shot (with rollout), then writes into each club:
- `carry`  = round(mean engine carry)        `total` = round(mean engine total, after roll)
- `apex`   = round(mean engine apex ft)       `descent` = round(mean engine descent°)
- `n`, `spinaxis` (mean R50 axis), `flightTime` (mean engine hang time, s — drives 3D animation pacing)
- `ell` = dispersion ellipse from ENGINE landings: {cx: mean(carry), cz: mean(lateral),
          rx: sd(carry), rz: sd(lateral)}.  (No longer overwritten at runtime.)
- `mean`  = avg AERIAL path, flat [x,y,z,…] (x,z yd; y ft), 64 pts
- `shots` = per-shot AERIAL paths (64 pts each)
- `meanRoll` = avg GROUND path (bounce+roll); `roll` = per-shot ground paths (32 pts each)
- `derived` = per-shot ENGINE results: [{carry,total,apex,descent,dev,devTotal}, …]
              (club-detail's per-shot charts read THIS, not the R50 fields)
- `stats` = UNCHANGED (raw R50 launch + R50's own carry/apex/total/dev for reference)
Usage:  `python3 generate_trajectories.py`   (writes shots.json)
        `python3 generate_trajectories.py --check`  (report only)
Preserves the pretty-print format (numeric rows each on one line). Asserts/validates as it goes.

### flag_excluded.py  (marks excluded shots in raw-shots.json)
A raw shot is "excluded" if it has no counterpart in shots.json `stats` (dropped in cleaning).
Matches per club on NON-LATERAL fingerprint fields (bs, carry, apex, spin, la, total, bspin)
within rounding tolerance — lateral fields (dev/ld/axis) are skipped because one Gap Wedge
session was realigned. Writes `"excluded": true` onto the 8 dropped shots. Re-run after data
changes:  `python3 flag_excluded.py [--check]`. (Uses ensure_ascii=True to match file encoding;
inserts the flag as a minimal diff.)

## Pages (nav order, left → right)
1. **index.html** — Overview. Hero stat-strip + club summary table. **DATA-DRIVEN** from
   shots.json (no longer hardcoded). Carry/Total/±SD/Apex/Lateral SD come from the ENGINE
   (c.carry, c.total, c.apex, c.ell). Ball/Launch/Spin are R50 launch means from stats.
   Loft is a static per-club lookup in the script (club spec, not in data). Red lateral flag
   is a static set {3 Wood, Gap Wedge} (editorial two-way-miss call). Has a Total column.
2. **club-detail.html** — Club Detail. Pick a club; headline cards, carry histogram, top-down
   dispersion scatter, consistency bars, metrics table, shot-by-shot table. Per-shot values
   (carry/total/apex/dev) come from `d.derived` (engine); launch fields (bs/la/spin/axis) from
   `d.stats`. Merged into one array `S` at top of renderClub().
3. **trends.html** — Trends. Pick a club; session-over-session changes + a **"Why carry changed"**
   panel that calls `attributeCarryChange()` (first session vs latest) and shows ball-speed /
   launch / spin contribution bars that sum to the total, plus the measured-vs-modeled note.
   Imports flight-engine.js. Loads raw-shots.json (+ browser uploads). Health dots per club chip.
   Has an **"Average Shot"** box (between Metric-Over-Time and the table): engine-computed mean
   trajectory drawn as SIDE profile + TOP-DOWN animated SVGs (top-down shows lateral movement),
   animated at REAL-LIFE speed (engine flightTime) while on screen.
   Insight cards + the All-Metrics table color by TONE (good=green / bad=red / neutral=dim), driven
   by each metric's `better` field (`up`/`down`/`zero`/`neutral`) — NOT by raw direction. So a drop
   in Lateral Spread or Carry Consistency (SD) shows green (improvement) while the arrow still points
   down (real direction). `better:'zero'` (Lateral Bias) = good when |latest| shrinks toward 0;
   `neutral` metrics (apex/launch/spin) never color good/bad. The "Why carry changed" attribution
   panel keeps directional cyan/red (it decomposes the carry delta itself, not a good/bad judgment).
4. **top-down.html** — 2D Dispersion. Inline-SVG top-down (#top) + side profile (#side).
   Pinch-zoom/pan, All on/off, individual-shots toggle. Loads shots.json. normalizeCarries REMOVED.
5. **flight-3d.html** — 3D Flight. Three.js (type=module, importmap → three@0.160.0 cdnjs).
   Has a **"Roll-out" toggle** (next to Show shots / Show mean): when on, draws a dimmer/thinner
   tube tracing each club's bounce+roll ground path (from meanRoll) to a hollow rest marker.
   normalizeCarries REMOVED — engine landing IS the carry. **Launch** animates the ball over its
   REAL hang time (uses `flightTime`; pacing const `TIMESCALE`) then continues through the bounce
   + roll-out to rest (along `meanRoll`, pace `ROLL_MS_PER_YD`) like libgolf; HUD shows live decelerating ball
   speed in mph (computed from real distance/time per frame). Drawn TRUE-TO-SCALE (height ft
   converted to yards via `Hscale=VEXAG/3`, VEXAG=1; matches libgolf's ~1:1 look — was a 3x
   units bug before). Mobile: Launch button lives in
   `.launchbar` (z-48); control bars hide via `body.drawer-open` when the clubs drawer is open.
6. **raw-data.html** — Raw Data (far right, intentionally LAST). Sortable/filterable table of all
   raw shots; session+club filter chips, search, CSV upload (browser-local). Shows an
   **"In Model" column**: red "Excluded" badge + dimmed row for the 8 dropped shots (reads the
   `excluded` flag from raw-shots.json), included shots show a ✓. Count pill notes "N excluded".

**model.html** — "The Model" reference page (NOT in the main nav — it's a secondary sub-page
   linked from the Overview "About the model" card via `href="model.html"`). A long-form
   explanation of how launch data becomes ball flight, with the ACTUAL engine equations rendered
   via MathJax (cdnjs, tex-mml-chtml 3.2.2): air density / lumped c0 / Reynolds setup, launch &
   spin vectors, drag + Magnus + spin-decay, the Cd/Cl coefficient fits (verbatim values), the
   semi-implicit Euler integrator, Penner bounce + roll, and the one low-spin Cd tweak. It carries
   the standard `.nav` (so it feels native) but intentionally has NO active tab. Pulls its numbers
   from flight-engine.js — if engine coefficients change, update this page's equations too.

All pages share an identical sticky `.nav`. Adding a primary TAB page = add its tab to ALL pages,
set `class="tab on"` only on the active one. (model.html is the one deliberate exception: it's a
linked sub-page, not a tab, to keep the nav uncluttered — its nav shows no active tab.)

## raw-shots.json  (raw R50 data — drives raw-data + trends)
`{ club_order:[...], sessions:[...], colors:{club:hex}, shots:[...] }`
- `club_order` (ascending by length): Sand Wedge, Gap Wedge, Pitching Wedge, 9/8/7/6/5/4/3 Iron, 3 Wood.
- `sessions`: `[{id,label,date,start,n}]`. Label e.g. "Jun 5, 2026 · 3:24 PM".
- `shots`: flat list, each `{session, session_label, ts(ISO), date, club, bs,la,ld,bspin,sspin,
  spin,axis,apex,carry,total,dev, excluded?}`. **5 sessions, 242 raw shots; 8 excluded → 234 modeled.**
  KEY RULE: each CSV file = one session (never merge by time-gap).
- Excluded breakdown: 3× 3 Wood (topped, low apex) + 1 each 3I, 4I, 6I, PW, GW.

## R50 CSV export format (for parsing future uploads)
UTF-8 BOM. Row1 headers, Row2 units (skip — its Date cell empty), then shot rows.
Date like "06/05/26 15:24:33 PM" (AM/PM buggy; time is 24h). Columns: Date, Player, Club Type,
[Club Face], Ball Speed, Launch Angle, Launch Direction, Backspin, Sidespin, Spin Rate,
Spin Rate Type, Spin Axis, Apex Height, Carry Distance, Carry Deviation Angle, Carry Deviation
Distance, Total Distance, ... 5th file also has Club Speed, Attack Angle, Club Path, Face to Path,
Smash Factor. Field map: Ball Speed→bs, Launch Angle→la, Launch Direction→ld, Backspin→bspin,
Sidespin→sspin, Spin Rate→spin, Spin Axis→axis, Apex Height→apex, Carry Distance→carry,
Total Distance→total, Carry Deviation Distance→dev, Club Speed→cs, Smash Factor→smash.

## CSV upload (raw-data) — browser-local, not permanent
Upload button parses CSVs in-browser → browser local storage (`window.storage` key
`uploaded_shots`). Per-device, not shared. Each file = one session, de-duped by ts+club.
To make a session PERMANENT/shared: fold the CSV into raw-shots.json's `shots` (one session per
file, with excluded flags via flag_excluded.py), then re-run generate_trajectories.py, then
hand-update nothing (index/club-detail/2D/3D all read shots.json automatically). True
upload-and-persist would need a backend (Supabase/Firebase/serverless/Sheets) — user declined.

## ADDING A NEW SESSION — full procedure
1. Add the file's shots to `raw-shots.json` `shots` (one session; add a `sessions` entry).
2. Decide exclusions; add the surviving launch rows to the matching club `stats` in shots.json.
3. `python3 flag_excluded.py`         (re-flag excluded in raw-shots.json)
4. `python3 generate_trajectories.py` (recompute ALL engine outputs in shots.json)
5. Validate: `node --check flight-engine.js`; load each page over http; eyeball 2D/3D.
6. Commit + push. NO hand-editing of HTML numbers — everything is data-driven now.

## Favicon / logo
"AM" monogram, dark on lime (#d4ff4f) tile. Files in root: favicon.ico, favicon-32.png,
favicon-16.png, apple-touch-icon.png, icon-192.png, favicon-512.png. <link> tags in all heads.

## Palette / fonts
--bg:#070d0a --bg2:#0b1410 --panel:#0e1a14 --line:#1d3327 --line2:#26432f --ink:#e8f3ec
--dim:#8aa596 --dim2:#5e7568 --accent:#d4ff4f (lime) --accent2:#7fd4ff (cyan). Bad/negative=#ff9d9d.
Fonts (Google): Bebas Neue (display), Barlow Condensed (body), IBM Plex Mono (labels/data).
Charts on top-down/club-detail/trends are hand-rolled inline SVG. flight-3d is the only Three.js
page. Mobile breakpoint @media(max-width:760px).

## Conventions when editing
- shots.json numeric rows (mean/meanRoll/shots/roll/stats/derived) each stay on ONE line —
  the generator's serializer does this; preserve it if hand-editing.
- Syntax-check page JS: extract the `<script type="module">` block and `node --check`.
  flight-engine.js: `node --check flight-engine.js`.
- Validate JSON: `python3 -c "import json;json.load(open('shots.json'))"`.
- Serve-test: `python3 -m http.server` + curl for 200.
- Claude renders nothing in a browser — flag chart/layout changes as "please eyeball once live".

## History of major changes (most recent first)
- **3D launch fix + real-time speed + Trends top-down (this session):** (1) FIXED the 3D Launch
  that appeared broken — it wasn't: the animated ball had been over-shrunk to radius 0.45 (≈16 in
  at true 1:1 scale) so it was an invisible speck. Restored visible sizes (ball 1.6, landing marker
  1.4, rest marker 1.2). (2) 3D animation now plays at TRUE real-life speed: `TIMESCALE` 0.46→1.0,
  clamps widened (300–12000 ms) so each club's real flightTime passes through unchanged. (3) Trends
  "Average Shot" box: replaced the down-the-line view with a TOP-DOWN view (downrange horizontal,
  lateral vertical, target line centered) to actually show lateral movement; and its ball now
  animates at real-life speed using the engine `flightTime` (data-ft attr), looping flightTime+0.9s
  hold instead of a fixed 2.6s. flight-3d.html + trends.html.
- **Trends "Average Shot" views (this session):** added a box on the Trends page (between
  Metric-Over-Time and the All-Metrics table) showing two engine-computed SVG views of the selected
  club's MEAN-launch trajectory — SIDE profile (left, wider; height vs carry) and DOWN-THE-LINE
  (right, narrower; lateral vs downrange, viewed from behind the tee). The ball animates along each
  path, looping every 4 s (flies ~2.6 s, then holds), and only runs while the box is scrolled into
  view (IntersectionObserver). Functions `flightViews()` + `animateFlightViews()`; computes the path
  live via `simulateFlight` (no shots.json dependency). trends.html only.
- **Added model.html "The Model" page (this session):** new physics/math reference page documenting
  the full launch-data -> ball-flight derivation with the actual engine equations (MathJax via
  cdnjs). Linked from the Overview "About the model" card (`href="model.html"`); NOT added as a nav
  tab (kept as a linked sub-page). Also corrected that card's stale text — it said "Carries are
  measured" which is no longer true (carries are engine-computed). Page mirrors flight-engine.js;
  keep equations in sync if coefficients change.
- **Trends coloring fix (this session):** insight cards + All-Metrics table were coloring every
  change by raw direction (down=red), so improvements in dispersion/consistency (Lateral Spread,
  Carry Consistency — both `better:'down'`) showed red even though down is GOOD. Now color follows
  a `tone` (good=GREEN `--good #7CFFA0` / bad=red / neutral=dim) computed from each metric's
  `better` field; the arrow still shows real direction. Also FIXED the significance gate in
  classify2: SD/spread metrics used to require a change > 0.5x the pooled SD (e.g. lateral spread
  had to move >5 yd to count), so real tightenings showed gray. Now SD metrics use a fraction-of-
  baseline threshold (>15%, min 0.8 yd); mean metrics keep the sampling-noise test. Handled
  `better:'zero'` (Lateral Bias good when |value| shrinks). The Metric-Over-Time line chart is
  now colored by the SELECTED metric's good/bad tone (same green `--good`/red `--bad` as the table
  rows), not the club color — neutral/non-significant metrics fall back to the club color.
  Attribution panel unchanged (its cyan/red is a directional decomposition of the carry delta,
  correct as-is). trends.html only.
- **3D field size, tube thickness, roll-path style (this session):** (1) shrank the oversized
  ground field — was a 600x600 yd square GridHelper centered at x=150 (lateral spanned +/-300 yd
  for shots that miss by ~+/-20); now an explicit line grid `FIELD_X0..FIELD_X1` = -20..320 yd
  downrange, `FIELD_Z` = +/-70 yd lateral. (2) Mean-path tube thinned via shared `TUBE_R`
  const (0.805 -> 0.5635 -> later halved to 0.282). End-of-path markers also halved
  (landing 0.55, rest 0.475, animated ball 0.45). (3) The roll-out tube is now drawn the SAME as the aerial tube (same
  `TUBE_R`, same solid color) so carry + roll read as one continuous trajectory, instead of the
  old dimmer/thinner (0.28, opacity 0.5) separate-looking element. Roll tube still gated by the
  Roll-out toggle. flight-3d.html only; no engine/data change.
- **3D launch animation: roll-out + marker sizes (this session):** the ball animation now
  continues through the GROUND interaction (bounce + roll to rest) instead of stopping at
  touchdown, like the libgolf visualizer. Two phases in stepFlights: `phase:'air'` (aerial,
  real-time/decelerating as before) then `phase:'roll'` along the club's `meanRoll` ground
  path (stored as `o.rollPts`, de-duped). Roll pace is distance-scaled (`ROLL_MS_PER_YD`,
  clamped). Wedges visibly check/roll back (Gap Wedge 104->102.5), woods roll forward (3W
  274->282). The HUD switches to "rolling out / total N yd" during the roll. Roll always
  animates on Launch when ground data exists — independent of the Roll-out TOGGLE (which
  still controls the static dimmer roll tubes). Also shrank the oversized markers that hid
  the roll: animated ball radius 2.6->0.9, landing marker 3.2->1.1, rest marker 2.6->0.95,
  roll tube radius 0.5->0.28 (at true scale 1 unit=1 yd, the old ball was ~5 yd wide). No
  engine/data change — flight-3d.html only.
- **3D trajectory vertical-scale fix (this session):** the 3D flight arc was being drawn
  ~3.2x too tall, making every shot (esp. the 3W) look like a steep iron instead of the
  flat, penetrating libgolf shape. Root cause was a units bug: engine height is in FEET but
  downrange/lateral are in YARDS, and `P()` plotted height as `y*Hscale*3` with Hscale=1/3,
  i.e. feet-as-yards (3x). The old "Vertical axis exaggerated 3x" footer note was a
  post-hoc rationalization of that bug, not a design choice. Fixed: `P()` now converts
  feet->yards via `Hscale=VEXAG/3` (VEXAG=1 => true-to-scale, matching libgolf's ~1:1
  visualizer; raise VEXAG if the arc reads too flat when orbiting). Verified against the
  libgolf reference image (pixel-measured): both now ~0.15 height/width and apex at ~65% of
  carry. Also fixed the dependent feet conversions (live-speed distance calc + HUD height
  readout: feet = pos.y/Hscale) and retuned camera presets/initial target for the flatter
  arc. No engine/data change — purely how flight-3d.html draws. Constants at top of the
  render section: `VEXAG`, `FT_PER_YD`, `Hscale`.
- **3D flight animation: real-time speed + mobile launch fix (this session):**
  flight-3d.html's Launch animation now plays each shot over its REAL hang time
  (scaled by `TIMESCALE`=0.46, clamped 1.1–3.6s) instead of a flat 1.5s, so a 3W
  visibly hangs longer than a wedge. The HUD now shows LIVE ball speed in mph,
  computed from real distance/real-time between frames — it decelerates naturally
  (~launch ball speed off the face → ~30s mph near landing) because the engine's
  mean path points are time-uniform. Requires `flightTime` per club in shots.json
  (added to generate_trajectories.py: driver now returns r.flightTime; mean stored
  as `c['flightTime']`, seconds). Mobile: the Launch button was unreachable (the
  collapsed clubs-drawer handle, z-45, sat over the launch bar, z-32). Fixed by
  raising `.launchbar` to z-48 / bottom:60px and hiding the floating control bars
  while the drawer is open (`body.drawer-open` class toggled with the drawer).
  RE-RUN generate_trajectories.py is required for flightTime to appear.
- **Low-spin drag correction (this session):** fixed the 3W (and 3I) under-prediction. Added the
  `LOWSPIN_CD_*` params + a drag-only Cd reduction in `computeCd` (flight-engine.js), gated on spin
  ratio S so only S<0.20 shots (3W, edge of 3I) are affected and the validated 4I-and-up bag is
  untouched. Regenerated shots.json. Result: 3W carry 257→270 (matches measured 271 / Spencer's
  real-world ~270), 3I 222→226, bag RMSE 5.95→4.2. This is the ONE departure from verbatim libgolf;
  GAIN=0 reverts. See the validation block above for full per-club bias + tuning knobs.
- **Engine rewrite (prior session):** added flight-engine.js (libgolf/Nathan port: aerial + bounce
  + roll). Made the site fully engine-driven — R50 = launch data only; carry/total/apex/descent/
  lateral all computed by the engine. Removed normalizeCarries from 2D/3D. Regenerated shots.json
  via generate_trajectories.py (adds meanRoll/roll/derived/total). Added 3D "Roll-out" toggle.
  index gained a Total column; index/club-detail now read engine values. Added Trends "Why carry
  changed" attribution panel. NOTE: carries shifted to engine values (3W measured 271 → engine 257
  at the time; the low-spin correction above later brought the 3W back to 270).
- Made index.html fully data-driven from shots.json (was hardcoded).
- Raw Data "In Model" column flags the 8 excluded shots (flag_excluded.py + excluded flag).
- Rebrand BagMetrics → AbsherMetrics. NOTE: index footer still literally says "BAGMETRICS";
  hero still "MY BAG, BY THE NUMBERS" (user aware, hasn't asked to change).
- Earlier: extracted data into shots.json; 5-sessions-one-per-file + club_order; trend health
  dots; mobile fixes; removed 3 topped 3-Wood outliers.

## Known open / possible next items
- index footer still says "BAGMETRICS"; hero still "MY BAG, BY THE NUMBERS".
- 3 Wood carry is now corrected (was ~−14 yd under-predicted; the `LOWSPIN_CD_*` drag correction
  brought it to 270 vs measured 271). If a future session wants the pure unmodified libgolf model
  back, set `LOWSPIN_CD_GAIN: 0` in the AERO block and re-run generate_trajectories.py. Watch that
  new low-spin clubs/sessions (e.g. an added driver) fall sensibly within the S<0.20 ramp — if a
  driver comes in, eyeball its carry vs feel and retune GAIN/SHI/SLO only if needed.
- Lateral/dispersion now fully from engine (no measured-dev anchor) — eyeball that 2D dots + 3D
  landing ellipses still look right vs your sense of your misses.
- Could add a surface selector (fairway/green/firm) to the 3D roll-out using GROUND overrides.
- render.yaml HTML Cache-Control could be lowered to reduce stale-page lag (offered, not done).
- Possible features discussed: club-comparison overlay, "what club from here" calculator,
  printable yardage card, CSV export, true persistent uploads (needs backend).

## Environment notes
- libgolf source was cloned for reference during the engine port (github.com/gdifiore/libgolf).
  The port lives entirely in flight-engine.js; libgolf itself is NOT a runtime dependency.
- Node available for `node --check` and for generate_trajectories.py's engine driver.
- Pillow available; ImageMagick has no SVG delegate.
