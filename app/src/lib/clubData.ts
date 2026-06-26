/**
 * Client-side port of generate_trajectories.py: turn a user's RAW shots into the
 * same per-club ClubData shape the screens already consume (carry/total/apex/
 * descent/ell/mean/shots/meanRoll/roll/derived/stats). Everything is computed
 * on-device with flight-engine.js — no server compute, no pre-baking.
 */
import { simulateFlight } from '@/engine';
import { mean, sd } from '@/lib/format';
import { type ClubData, type ShotStat } from '@/data';
import { type RawShot } from '@/rawData';

// Canonical order (ascending by length) + per-club colors — mirror raw-shots.json.
export const CLUB_ORDER: string[] = [
  'Sand Wedge', 'Gap Wedge', 'Pitching Wedge', '9 Iron', '8 Iron', '7 Iron',
  '6 Iron', '5 Iron', '4 Iron', '3 Iron', '3 Wood',
];
export const CLUB_COLORS: Record<string, string> = {
  '3 Wood': '#7fd4ff', '3 Iron': '#5fb8ff', '4 Iron': '#9d7bff', '5 Iron': '#c46bff',
  '6 Iron': '#ff6bd0', '7 Iron': '#ff7a7a', '8 Iron': '#ff9d52', '9 Iron': '#ffc24f',
  'Pitching Wedge': '#ffe94f', 'Gap Wedge': '#d4ff4f', 'Sand Wedge': '#9dff7f',
};
// Standard TaylorMade-ish defaults (degrees); users override per club in Settings.
export const DEFAULT_LOFTS: Record<string, number> = {
  Driver: 10.5, '5 Wood': 18, '3 Wood': 15, Hybrid: 19,
  '3 Iron': 20, '4 Iron': 23, '5 Iron': 26, '6 Iron': 30, '7 Iron': 34,
  '8 Iron': 39, '9 Iron': 42.5, 'Pitching Wedge': 47, 'Gap Wedge': 52,
  'Sand Wedge': 56, 'Lob Wedge': 60,
};

// Natural bag order, LONGEST first, for sorting an arbitrary set of clubs
// (including ones not in DEFAULT_LOFTS, e.g. a Driver from an uploaded session).
// Unknown clubs sort to the end. Used so the bag/settings reflect real data.
const NATURAL_ORDER: string[] = [
  'Driver',
  '2 Wood', '3 Wood', '4 Wood', '5 Wood', '7 Wood', '9 Wood',
  '1 Hybrid', '2 Hybrid', '3 Hybrid', '4 Hybrid', '5 Hybrid', '6 Hybrid', '7 Hybrid', 'Hybrid',
  '1 Iron', '2 Iron', '3 Iron', '4 Iron', '5 Iron', '6 Iron', '7 Iron', '8 Iron', '9 Iron',
  'Pitching Wedge', 'Approach Wedge', 'Gap Wedge', 'Sand Wedge', 'Lob Wedge',
];
/** Sort rank (longest club first). Unknown clubs go to the end. */
export const clubSortIdx = (club: string): number => {
  const i = NATURAL_ORDER.indexOf(club);
  return i < 0 ? NATURAL_ORDER.length : i;
};

const FALLBACK_COLORS = ['#d4ff4f', '#7fd4ff', '#ff9d9d', '#b6f24f', '#4fd6a8', '#f2b24f', '#c98fff'];
export const clubColor = (club: string, i = 0) => CLUB_COLORS[club] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];

const NPTS = 64;
const GPTS = Math.max(2, Math.round(NPTS / 2)); // 32

type Pt3 = number[]; // [x_downrange_yd, height_ft, z_lateral_yd]

// interpolate a path to n points, flattened to [x,y,z, x,y,z, ...]
function resample(p: Pt3[] | undefined, n: number): number[] {
  const res: number[] = [];
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

const r1arr = (a: number[]) => a.map((v) => Math.round(v * 10) / 10);
const num = (v: unknown) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);

// Memoize simulateFlight: identical launch inputs → identical flight. Keyed by rounded
// inputs so re-computing clubs after an import/delete only re-simulates genuinely NEW
// shots — the existing hundreds return instantly from cache (the dominant cost in
// computeClubs is this per-shot integration). Result objects are only ever READ by
// computeClub (resample/derived), never mutated, so sharing a cached object is safe.
const _simCache = new Map<string, ReturnType<typeof simulateFlight>>();
function sim(launch: { bs: number; la: number; spin: number; axis: number; dir: number }) {
  const key =
    Math.round(launch.bs * 10) +
    '|' +
    Math.round(launch.la * 10) +
    '|' +
    Math.round(launch.spin) +
    '|' +
    Math.round((launch.axis || 0) * 10) +
    '|' +
    Math.round((launch.dir || 0) * 10);
  const hit = _simCache.get(key);
  if (hit) return hit;
  const r = simulateFlight(
    {
      ballSpeedMph: launch.bs,
      launchDeg: launch.la,
      spinRpm: launch.spin,
      axisDeg: launch.axis || 0,
      directionDeg: launch.dir || 0,
    },
    { rollout: true },
  );
  if (_simCache.size > 4000) _simCache.clear(); // bound memory on huge accounts
  _simCache.set(key, r);
  return r;
}

/** Compute one club's ClubData from its raw shots (must have bs/la/spin). */
export function computeClub(club: string, rows: RawShot[], color: string): ClubData | null {
  const st = rows.filter((r) => r.bs != null && r.la != null && r.spin != null);
  if (!st.length) return null;
  const col = (k: keyof RawShot) => st.map((r) => num(r[k] as number));

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

  const stats: ShotStat[] = st.map((r) => ({
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
export function computeClubs(rawShots: RawShot[]): ClubData[] {
  const byClub = new Map<string, RawShot[]>();
  for (const s of rawShots) {
    if (s.excluded) continue; // excluded shots don't feed averages/charts
    if (!byClub.has(s.club)) byClub.set(s.club, []);
    byClub.get(s.club)!.push(s);
  }
  const orderIdx = (c: string) => {
    const i = CLUB_ORDER.indexOf(c);
    return i < 0 ? 999 : i;
  };
  const clubs = [...byClub.keys()].sort((a, b) => orderIdx(a) - orderIdx(b));
  const out: ClubData[] = [];
  clubs.forEach((club, i) => {
    const cd = computeClub(club, byClub.get(club)!, clubColor(club, i));
    if (cd) out.push(cd);
  });
  return out;
}
