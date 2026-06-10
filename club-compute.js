// club-compute.js — turn a user's RAW shots into the per-club ClubData[] the web
// pages already consume (the exact shape of the bundled shots.json), computed in
// the browser via the shared flight-engine.js. No server, no pre-baking.
//
// This is a faithful 1:1 port of the mobile app's app/src/lib/clubData.ts
// (itself a port of generate_trajectories.py). The web 3D/2D pages render the
// output unchanged — only the SOURCE of the data moves from a static file to
// the signed-in user's shots.
import { simulateFlight } from './flight-engine.js';

// ---- numeric helpers (mirror app/src/lib/format.ts exactly) ----
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); // sample SD
};

// Canonical order (ascending by length) + per-club colors — mirror raw-shots.json.
export const CLUB_ORDER = [
  'Sand Wedge', 'Gap Wedge', 'Pitching Wedge', '9 Iron', '8 Iron', '7 Iron',
  '6 Iron', '5 Iron', '4 Iron', '3 Iron', '3 Wood',
];
export const CLUB_COLORS = {
  '3 Wood': '#7fd4ff', '3 Iron': '#5fb8ff', '4 Iron': '#9d7bff', '5 Iron': '#c46bff',
  '6 Iron': '#ff6bd0', '7 Iron': '#ff7a7a', '8 Iron': '#ff9d52', '9 Iron': '#ffc24f',
  'Pitching Wedge': '#ffe94f', 'Gap Wedge': '#d4ff4f', 'Sand Wedge': '#9dff7f',
};
// Standard TaylorMade-ish defaults (degrees); users override per club in Settings.
export const DEFAULT_LOFTS = {
  Driver: 10.5, '5 Wood': 18, '3 Wood': 15, Hybrid: 19,
  '3 Iron': 20, '4 Iron': 23, '5 Iron': 26, '6 Iron': 30, '7 Iron': 34,
  '8 Iron': 39, '9 Iron': 42.5, 'Pitching Wedge': 47, 'Gap Wedge': 52,
  'Sand Wedge': 56, 'Lob Wedge': 60,
};

// Natural bag order, LONGEST first, for sorting an arbitrary set of clubs
// (including ones not in DEFAULT_LOFTS, e.g. a Driver from an uploaded session).
const NATURAL_ORDER = [
  'Driver',
  '2 Wood', '3 Wood', '4 Wood', '5 Wood', '7 Wood', '9 Wood',
  '1 Hybrid', '2 Hybrid', '3 Hybrid', '4 Hybrid', '5 Hybrid', '6 Hybrid', '7 Hybrid', 'Hybrid',
  '1 Iron', '2 Iron', '3 Iron', '4 Iron', '5 Iron', '6 Iron', '7 Iron', '8 Iron', '9 Iron',
  'Pitching Wedge', 'Approach Wedge', 'Gap Wedge', 'Sand Wedge', 'Lob Wedge',
];
/** Sort rank (longest club first). Unknown clubs go to the end. */
export const clubSortIdx = (club) => {
  const i = NATURAL_ORDER.indexOf(club);
  return i < 0 ? NATURAL_ORDER.length : i;
};

const FALLBACK_COLORS = ['#d4ff4f', '#7fd4ff', '#ff9d9d', '#b6f24f', '#4fd6a8', '#f2b24f', '#c98fff'];
export const clubColor = (club, i = 0) => CLUB_COLORS[club] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];

const NPTS = 64;
const GPTS = Math.max(2, Math.round(NPTS / 2)); // 32

// interpolate a path to n points, flattened to [x,y,z, x,y,z, ...]
function resample(p, n) {
  const res = [];
  if (!p || p.length <= 1) {
    for (let i = 0; i < n; i++) res.push(0, 0, 0);
    return res;
  }
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (p.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, p.length - 1);
    const f = t - lo;
    res.push(
      p[lo][0] + (p[hi][0] - p[lo][0]) * f,
      p[lo][1] + (p[hi][1] - p[lo][1]) * f,
      p[lo][2] + (p[hi][2] - p[lo][2]) * f,
    );
  }
  return res;
}

const r1arr = (a) => a.map((v) => Math.round(v * 10) / 10);
const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);

function sim(launch) {
  return simulateFlight(
    {
      ballSpeedMph: launch.bs,
      launchDeg: launch.la,
      spinRpm: launch.spin,
      axisDeg: launch.axis || 0,
      directionDeg: launch.dir || 0,
    },
    { rollout: true },
  );
}

/** Compute one club's ClubData from its raw shots (must have bs/la/spin). */
export function computeClub(club, rows, color) {
  const st = rows.filter((r) => r.bs != null && r.la != null && r.spin != null);
  if (!st.length) return null;
  const col = (k) => st.map((r) => num(r[k]));

  const meanLaunch = {
    bs: mean(col('bs')),
    la: mean(col('la')),
    spin: mean(col('spin')),
    axis: mean(col('axis')),
    dir: mean(col('ld')),
  };
  const meanRes = sim(meanLaunch);
  const shotRes = st.map((r) =>
    sim({ bs: num(r.bs), la: num(r.la), spin: num(r.spin), axis: num(r.axis), dir: num(r.ld) }),
  );

  const eCarry = shotRes.map((r) => r.carryYd);
  const eTotal = shotRes.map((r) => r.totalYd ?? r.carryYd);
  const eApex = shotRes.map((r) => r.apexFt);
  const eDesc = shotRes.map((r) => r.descentDeg);
  const eLat = shotRes.map((r) => r.lateralYd);
  const eFT = shotRes.map((r) => r.flightTime);

  const stats = st.map((r) => ({
    bs: num(r.bs), la: num(r.la), ld: num(r.ld), bspin: num(r.bspin), sspin: num(r.sspin),
    spin: num(r.spin), axis: num(r.axis), apex: num(r.apex), carry: num(r.carry),
    total: num(r.total), dev: num(r.dev),
  }));

  return {
    club,
    color,
    carry: Math.round(mean(eCarry)),
    total: Math.round(mean(eTotal)),
    apex: Math.round(mean(eApex)),
    descent: Math.round(mean(eDesc)),
    n: st.length,
    spinaxis: Math.round(mean(col('axis')) * 10) / 10,
    flightTime: Math.round(mean(eFT) * 100) / 100,
    ell: {
      cx: Math.round(mean(eCarry) * 10) / 10,
      cz: Math.round(mean(eLat) * 10) / 10,
      rx: Math.round(sd(eCarry) * 10) / 10,
      rz: Math.round(sd(eLat) * 10) / 10,
    },
    stats,
    mean: r1arr(resample(meanRes.points, NPTS)),
    shots: shotRes.map((r) => r1arr(resample(r.points, NPTS))),
    meanRoll: r1arr(resample(meanRes.groundPoints, GPTS)),
    roll: shotRes.map((r) => r1arr(resample(r.groundPoints, GPTS))),
    derived: shotRes.map((r) => ({
      carry: Math.round(r.carryYd * 10) / 10,
      total: Math.round((r.totalYd ?? r.carryYd) * 10) / 10,
      apex: Math.round(r.apexFt * 10) / 10,
      descent: Math.round(r.descentDeg * 10) / 10,
      dev: Math.round(r.lateralYd * 10) / 10,
      devTotal: Math.round((r.totalLateralYd ?? r.lateralYd) * 10) / 10,
    })),
  };
}

/** Compute all clubs (ascending by length) from a flat list of raw shots. */
export function computeClubs(rawShots) {
  const byClub = new Map();
  for (const s of rawShots) {
    if (s.excluded) continue; // excluded shots don't feed averages/charts
    if (!byClub.has(s.club)) byClub.set(s.club, []);
    byClub.get(s.club).push(s);
  }
  const orderIdx = (c) => {
    const i = CLUB_ORDER.indexOf(c);
    return i < 0 ? 999 : i;
  };
  const clubs = [...byClub.keys()].sort((a, b) => orderIdx(a) - orderIdx(b));
  const out = [];
  clubs.forEach((club, i) => {
    const cd = computeClub(club, byClub.get(club), clubColor(club, i));
    if (cd) out.push(cd);
  });
  return out;
}
