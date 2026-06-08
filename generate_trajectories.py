#!/usr/bin/env python3
"""
generate_trajectories.py — rebuild shots.json flight paths from the flight engine.

WHAT IT DOES
  shots.json drives the Overview, Club Detail, 2D Dispersion, and 3D Flight
  pages. Each club carries:
    - summary scalars (carry, apex, descent, n, spinaxis) + ell {cx,cz,rx,rz}
    - `mean`  : the average flight path, flat [x,y,z, ...] (64 pts; x,z yd, y ft)
    - `shots` : one flight path per measured shot, same layout
    - `stats` : the raw per-shot R50 rows (UNCHANGED — these are the source data)

  This script regenerates `mean` and `shots` from flight-engine.js so the
  rendered ball flights come from the documented Nathan/libgolf physics rather
  than opaque precomputed numbers. The pages' normalizeCarries() still rescales
  each path's downrange so it LANDS at the measured carry — so distances stay
  exactly as measured; only the flight SHAPE (apex/curve/descent) comes from
  the engine.

  Everything else in shots.json is preserved byte-for-byte where possible:
  stats rows untouched, club order untouched, colors untouched, and the
  summary scalars recomputed from stats with the same formulas as before.

HOW IT CALLS THE ENGINE
  The physics lives in flight-engine.js (single source of truth). Rather than
  re-port it to Python, we shell out to Node, feeding launch rows in and
  reading trajectories back as JSON. That guarantees the site and this
  generator use the identical model.

RE-RUN WHENEVER
  shots.json's stats change (new session folded in, exclusions changed).
    node --check flight-engine.js          # sanity
    python3 generate_trajectories.py       # rewrites shots.json in place
    python3 generate_trajectories.py --check  # report, do not write
"""
import json, subprocess, sys, statistics, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots.json')
ENGINE = os.path.join(HERE, 'flight-engine.js')
NPTS = 64  # points per resampled trajectory (matches existing shots.json)

def mean(a): return sum(a)/len(a)
def sample_sd(a): return statistics.stdev(a) if len(a) > 1 else 0.0

def run_engine(jobs):
    """jobs: list of {bs,la,spin,axis}. Returns list of resampled [x,y,z,...]
    flat arrays (downrange yd, height ft, lateral yd), NPTS points each."""
    driver = r'''
import { simulateFlight } from './flight-engine.js';
let raw=''; process.stdin.on('data',d=>raw+=d); process.stdin.on('end',()=>{
  const jobs=JSON.parse(raw); const NPTS=%d; const out=[];
  for(const j of jobs){
    const r=simulateFlight({ballSpeedMph:j.bs,launchDeg:j.la,spinRpm:j.spin,axisDeg:j.axis||0});
    const p=r.points; // [x_yd, y_ft, z_yd]
    // resample to NPTS by arc-length-agnostic even index over the path
    const res=[];
    if(p.length<=1){ for(let i=0;i<NPTS;i++) res.push(0,0,0); }
    else{
      for(let i=0;i<NPTS;i++){
        const t=i/(NPTS-1)*(p.length-1); const lo=Math.floor(t); const hi=Math.min(lo+1,p.length-1);
        const f=t-lo;
        res.push(
          p[lo][0]+(p[hi][0]-p[lo][0])*f,
          p[lo][1]+(p[hi][1]-p[lo][1])*f,
          p[lo][2]+(p[hi][2]-p[lo][2])*f);
      }
    }
    out.push({pts:res, carry:r.carryYd, apex:r.apexFt, descent:r.descentDeg, lateral:r.lateralYd});
  }
  process.stdout.write(JSON.stringify(out));
});
''' % NPTS
    drv_path = os.path.join(HERE, '.engine_driver.mjs')
    open(drv_path, 'w').write(driver)
    try:
        proc = subprocess.run(['node', drv_path], input=json.dumps(jobs),
                              capture_output=True, text=True, cwd=HERE, timeout=300)
        if proc.returncode != 0:
            sys.stderr.write(proc.stderr); raise RuntimeError('engine driver failed')
        return json.loads(proc.stdout)
    finally:
        if os.path.exists(drv_path): os.remove(drv_path)

def round_pts(flat, dp=1):
    return [round(v, dp) for v in flat]

def main():
    check = '--check' in sys.argv
    data = json.load(open(SHOTS))

    # Build one engine job per shot, per club, preserving order.
    jobs = []; index = []  # index: (club_i, 'mean'|shot_i)
    for ci, c in enumerate(data):
        st = c['stats']
        # mean trajectory uses the club's MEAN launch condition
        jobs.append({'bs': mean([r['bs'] for r in st]),
                     'la': mean([r['la'] for r in st]),
                     'spin': mean([r['spin'] for r in st]),
                     'axis': mean([r.get('axis', 0) for r in st])})
        index.append((ci, 'mean'))
        for si, r in enumerate(st):
            jobs.append({'bs': r['bs'], 'la': r['la'], 'spin': r['spin'], 'axis': r.get('axis', 0)})
            index.append((ci, si))

    results = run_engine(jobs)
    assert len(results) == len(jobs)

    # Stitch results back, recompute summaries, report deltas.
    report = []
    for ci, c in enumerate(data):
        st = c['stats']
        meanRes = None; shotRes = [None]*len(st)
        for (idx_ci, kind), res in zip(index, results):
            if idx_ci != ci: continue
            if kind == 'mean': meanRes = res
            else: shotRes[kind] = res

        # Anchor flight HEIGHT to measured apex, mirroring how the pages anchor
        # downrange to measured carry: physics sets the shape, measured data sets
        # the magnitude. We scale each path's y so its apex equals the measured
        # apex for that shot (mean path -> mean measured apex).
        def anchor_height(pts_flat, target_apex):
            ys = pts_flat[1::3]
            peak = max(ys) if ys else 0
            if peak <= 1e-6 or target_apex is None: return pts_flat
            s = target_apex / peak
            out = pts_flat[:]
            for i in range(1, len(out), 3): out[i] *= s
            return out

        mean_apex_meas = mean([r['apex'] for r in st])
        new_mean = round_pts(anchor_height(meanRes['pts'], mean_apex_meas))
        new_shots = [round_pts(anchor_height(shotRes[si]['pts'], st[si]['apex']))
                     for si in range(len(st))]

        # summary scalars from stats (same formulas the site has always used)
        carry = round(mean([r['carry'] for r in st]))
        apex  = round(mean([r['apex']  for r in st]))
        dev   = [r['dev'] for r in st]
        carries = [r['carry'] for r in st]
        ell = {
            'cx': round(mean(carries), 1),    # overwritten at runtime by normalizeCarries
            'cz': round(mean(dev), 1),
            'rx': round(sample_sd(carries), 1),
            'rz': round(sample_sd(dev), 1),
        }
        spinaxis = round(mean([r.get('axis', 0) for r in st]), 1)
        # descent from the engine's mean flight (was a fixed-ish summary before)
        descent = round(meanRes['descent'])

        report.append((c['club'], c.get('apex'), apex,
                       max(meanRes['pts'][1::3]),  # engine raw apex ft (pre-resample loss tiny)
                       c.get('descent'), descent))

        if not check:
            c['mean'] = new_mean
            c['shots'] = new_shots
            c['carry'] = carry
            c['apex'] = apex
            c['ell'] = ell
            c['spinaxis'] = spinaxis
            c['descent'] = descent
            c['n'] = len(st)

    print("%-15s | sum.apex old->new | engineApexFt | descent old->new" % "club")
    for r in report:
        print("%-15s |   %4s -> %4s    |   %6.1f     |   %4s -> %4s" % (
            r[0], r[1], r[2], r[3], r[4], r[5]))

    if check:
        print("\n--check: no file written.")
        return

    # Pretty-print preserving the site's format: clubs indented, each
    # number-array row (mean / each shots entry / each stats entry) on ONE line.
    write_shots(data)
    print("\nWrote shots.json with engine-generated trajectories.")

def write_shots(data):
    """Custom serializer: keeps mean/shots/stats numeric rows each on a single
    line (the format HANDOFF.md requires), other keys pretty."""
    def num(x):
        if isinstance(x, float):
            if x == int(x): return str(int(x))
            return repr(round(x, 4))
        return json.dumps(x)
    out = ['[']
    for ci, c in enumerate(data):
        out.append(' {')
        keys = list(c.keys())
        for ki, k in enumerate(keys):
            comma = ',' if ki < len(keys)-1 else ''
            v = c[k]
            if k == 'mean':
                out.append('  "mean": [' + ','.join(num(x) for x in v) + ']' + comma)
            elif k == 'shots':
                out.append('  "shots": [')
                for si, row in enumerate(v):
                    rc = ',' if si < len(v)-1 else ''
                    out.append('   [' + ','.join(num(x) for x in row) + ']' + rc)
                out.append('  ]' + comma)
            elif k == 'stats':
                out.append('  "stats": [')
                for si, row in enumerate(v):
                    rc = ',' if si < len(v)-1 else ''
                    out.append('   ' + json.dumps(row, ensure_ascii=False) + rc)
                out.append('  ]' + comma)
            else:
                out.append('  ' + json.dumps(k) + ': ' + json.dumps(v, ensure_ascii=False) + comma)
        out.append(' }' + (',' if ci < len(data)-1 else ''))
    out.append(']')
    open(SHOTS, 'w').write('\n'.join(out) + '\n')

if __name__ == '__main__':
    main()
