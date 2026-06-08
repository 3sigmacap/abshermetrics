#!/usr/bin/env python3
"""
generate_trajectories.py — compute ALL modeled shot data from the flight engine.

MODEL (engine-driven):
  The Garmin R50 provides only LAUNCH data — ball speed, launch angle, launch
  direction, back/side spin, total spin, spin axis. EVERYTHING downstream is
  computed by flight-engine.js (the libgolf / Alan Nathan model): carry, total
  (after bounce + roll), apex, descent angle, lateral landing. We no longer use
  the R50's own carry/apex/total/dev for any modeled output — those R50 fields
  stay in `stats` only so the Raw Data page can still show them for reference.

  The engine is the single source of truth: 2D dispersion, 3D flight, the index
  summary, club detail, and the Trends carry attribution all derive from it.
  There is no more "rescale to measured carry" step in the pages.

WRITES into each club object:
  carry   = round(mean engine carry)
  total   = round(mean engine total)   (after bounce + roll)
  apex    = round(mean engine apex ft)
  descent = round(mean engine descent deg)
  n       = shot count
  spinaxis= round(mean R50 axis,1)      (launch input)
  ell     = {cx: mean(engine carry), cz: mean(engine lateral),
             rx: sd(engine carry),   rz: sd(engine lateral)}
  mean    = average AERIAL path, flat [x,y,z,...] (yd,ft,yd)
  shots   = per-shot AERIAL paths
  meanRoll= average GROUND path (bounce+roll); roll = per-shot ground paths
  stats   = UNCHANGED

RE-RUN whenever stats change:
  python3 generate_trajectories.py            # writes shots.json
  python3 generate_trajectories.py --check    # report only
"""
import json, subprocess, sys, statistics, os

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots.json')
NPTS = 64

def mean(a): return sum(a)/len(a)
def sd(a): return statistics.stdev(a) if len(a) > 1 else 0.0

def run_engine(jobs):
    driver = r'''
import { simulateFlight } from './flight-engine.js';
let raw=''; process.stdin.on('data',d=>raw+=d); process.stdin.on('end',()=>{
  const jobs=JSON.parse(raw); const NPTS=%d; const out=[];
  const resample=(p,n)=>{ const res=[];
    if(!p||p.length<=1){ for(let i=0;i<n;i++) res.push(0,0,0); return res; }
    for(let i=0;i<n;i++){ const t=i/(n-1)*(p.length-1); const lo=Math.floor(t); const hi=Math.min(lo+1,p.length-1); const f=t-lo;
      res.push(p[lo][0]+(p[hi][0]-p[lo][0])*f, p[lo][1]+(p[hi][1]-p[lo][1])*f, p[lo][2]+(p[hi][2]-p[lo][2])*f); }
    return res; };
  for(const j of jobs){
    const r=simulateFlight({ballSpeedMph:j.bs,launchDeg:j.la,spinRpm:j.spin,axisDeg:j.axis||0,directionDeg:j.dir||0},{rollout:true});
    out.push({
      aerial: resample(r.points, NPTS),
      ground: resample(r.groundPoints, Math.max(2,Math.round(NPTS/2))),
      carry: r.carryYd, total: r.totalYd, apex: r.apexFt,
      descent: r.descentDeg, lateral: r.lateralYd, totalLateral: r.totalLateralYd,
    });
  }
  process.stdout.write(JSON.stringify(out));
});
''' % NPTS
    drv = os.path.join(HERE, '.engine_driver.mjs')
    open(drv, 'w').write(driver)
    try:
        p = subprocess.run(['node', drv], input=json.dumps(jobs),
                           capture_output=True, text=True, cwd=HERE, timeout=600)
        if p.returncode != 0:
            sys.stderr.write(p.stderr); raise RuntimeError('engine driver failed')
        return json.loads(p.stdout)
    finally:
        if os.path.exists(drv): os.remove(drv)

def rp(flat, dp=1): return [round(v, dp) for v in flat]

def main():
    check = '--check' in sys.argv
    data = json.load(open(SHOTS))

    jobs = []; index = []
    for ci, c in enumerate(data):
        st = c['stats']
        jobs.append({'bs': mean([r['bs'] for r in st]), 'la': mean([r['la'] for r in st]),
                     'spin': mean([r['spin'] for r in st]), 'axis': mean([r.get('axis',0) for r in st]),
                     'dir': mean([r.get('ld',0) for r in st])})
        index.append((ci, 'mean'))
        for si, r in enumerate(st):
            jobs.append({'bs': r['bs'], 'la': r['la'], 'spin': r['spin'],
                         'axis': r.get('axis',0), 'dir': r.get('ld',0)})
            index.append((ci, si))

    res = run_engine(jobs)
    assert len(res) == len(jobs)

    report = []
    for ci, c in enumerate(data):
        st = c['stats']
        meanRes = None; shotRes = [None]*len(st)
        for (idx_ci, kind), rr in zip(index, res):
            if idx_ci != ci: continue
            if kind == 'mean': meanRes = rr
            else: shotRes[kind] = rr

        eCarry = [r['carry'] for r in shotRes]
        eTotal = [r['total'] for r in shotRes]
        eApex  = [r['apex']  for r in shotRes]
        eDesc  = [r['descent'] for r in shotRes]
        eLat   = [r['lateral'] for r in shotRes]

        carry = round(mean(eCarry)); total = round(mean(eTotal))
        apex = round(mean(eApex)); descent = round(mean(eDesc))
        ell = {'cx': round(mean(eCarry),1), 'cz': round(mean(eLat),1),
               'rx': round(sd(eCarry),1), 'rz': round(sd(eLat),1)}
        spinaxis = round(mean([r.get('axis',0) for r in st]), 1)

        report.append((c['club'], c.get('carry'), carry, c.get('apex'), apex, total))

        if not check:
            c['mean']  = rp(meanRes['aerial'])
            c['shots'] = [rp(r['aerial']) for r in shotRes]
            c['meanRoll'] = rp(meanRes['ground'])
            c['roll']  = [rp(r['ground']) for r in shotRes]
            # per-shot ENGINE-derived results (carry/total/apex/descent/lateral),
            # so club-detail's per-shot charts use engine values, not R50 fields.
            c['derived'] = [{'carry': round(r['carry'],1), 'total': round(r['total'],1),
                             'apex': round(r['apex'],1), 'descent': round(r['descent'],1),
                             'dev': round(r['lateral'],1), 'devTotal': round(r['totalLateral'],1)}
                            for r in shotRes]
            c['carry'] = carry; c['total'] = total; c['apex'] = apex
            c['descent'] = descent; c['n'] = len(st); c['ell'] = ell
            c['spinaxis'] = spinaxis

    print("%-15s | carry old->new | apex old->new | total(new)" % "club")
    for r in report:
        print("%-15s |  %4s -> %4s  |  %4s -> %4s |   %4s" % (r[0], r[1], r[2], r[3], r[4], r[5]))

    if check:
        print("\n--check: no file written."); return
    write_shots(data)
    print("\nWrote shots.json (carry/total/apex/dispersion + paths all engine-derived).")

def write_shots(data):
    def num(x):
        if isinstance(x, float):
            if x == int(x): return str(int(x))
            return repr(round(x, 4))
        return json.dumps(x)
    ARR_KEYS = {'mean', 'meanRoll'}
    ARR2_KEYS = {'shots', 'roll'}
    out = ['[']
    for ci, c in enumerate(data):
        out.append(' {')
        keys = list(c.keys())
        for ki, k in enumerate(keys):
            comma = ',' if ki < len(keys)-1 else ''
            v = c[k]
            if k in ARR_KEYS:
                out.append('  ' + json.dumps(k) + ': [' + ','.join(num(x) for x in v) + ']' + comma)
            elif k in ARR2_KEYS:
                out.append('  ' + json.dumps(k) + ': [')
                for si, row in enumerate(v):
                    rc = ',' if si < len(v)-1 else ''
                    out.append('   [' + ','.join(num(x) for x in row) + ']' + rc)
                out.append('  ]' + comma)
            elif k == 'stats' or k == 'derived':
                out.append('  ' + json.dumps(k) + ': [')
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
