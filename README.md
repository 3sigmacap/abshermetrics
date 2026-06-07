# BagMetrics — Golf Launch-Monitor Site

A static 3-page site visualizing my bag:

- `index.html` — club summary table (model, loft, carry, gapping, dispersion)
- `top-down.html` — 2D top-down (true 1:1) + side flight profile, hover any dot for shot stats
- `flight-3d.html` — interactive 3D ball flight (drag to orbit, scroll to zoom)

All data is embedded directly in the HTML — there is **no build step and no backend**. Just static files.

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
