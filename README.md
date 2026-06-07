# BagMetrics — Golf Launch-Monitor Site

A static 3-page site visualizing my bag:

- `index.html` — club summary table (model, loft, carry, gapping, dispersion)
- `top-down.html` — 2D top-down (true 1:1) + side flight profile, hover any dot for shot stats
- `flight-3d.html` — interactive 3D ball flight (drag to orbit, scroll to zoom)

All shot data lives in one file, **`shots.json`**, which every page loads at runtime with `fetch()`. There is **no build step and no backend** — just static files.

### `shots.json` structure
A JSON array of 11 club objects. Each club holds:
- **Raw Garmin R50 data** — `stats`: one object per shot (`bs` ball speed, `la` launch angle, `ld` launch direction, `bspin`/`sspin`/`spin`, `axis`, `carry`, `total`, `dev` deviation, `apex`).
- **Physics-model flight paths** — `mean` (the average trajectory) and `shots` (one trajectory per shot), each a flat list of `x,y,z` points in yards.
- **Summary/meta** — `club`, `color`, `carry`, `apex`, `descent`, `n`, `ell` (dispersion ellipse), `spinaxis`.

To update with a new R50 session: add the raw shots to each club's `stats`, regenerate the matching `mean`/`shots` trajectories from the physics model, and save `shots.json`. All three pages pick up the change automatically — no HTML edits needed.

> Because the pages use `fetch('shots.json')`, they must be served over http (the local server below, or Render), not opened as a `file://` path.

## Deploy to Render.com

### Option A — Blueprint (one click)
1. Push this folder to a GitHub/GitLab repo.
2. In Render: **New → Blueprint**, select the repo. It reads `render.yaml` and deploys a Static Site.

### Option B — Manual Static Site
1. Push this folder to a Git repo.
2. In Render: **New → Static Site**, select the repo.
3. Settings:
   - **Build Command:** *(leave empty)*
   - **Publish Directory:** `.`
4. Create. Render serves the files and gives you a URL.

### Local preview
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Notes
- TaylorMade P7MB lofts (3i–PW): 20/23/26/30/34/39/42.5/47°. Gap 52°, Sand 56°, 3-Wood ~15°.
- Curves come from a drag + Magnus physics model fit to the launch data, not hand-drawn.
- One Gap-Wedge range session was realigned to correct a target-aim offset.
