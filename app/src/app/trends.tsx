import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Circle, G, Line, Path, Rect, Svg, Text as SvgText } from 'react-native-svg';

import { attributeAvgCarryChange, simulateFlight } from '@/engine';
import { useRawData } from '@/lib/dataStore';
import { fmt, mean, sd } from '@/lib/format';
import { type RawShot, type Session } from '@/rawData';
import { C } from '@/theme';

// ---------------------------------------------------------------------------
// METRICS — ported verbatim from trends.html
// ---------------------------------------------------------------------------
type Better = 'up' | 'down' | 'neutral' | 'zero';
interface Metric {
  key: string;
  label: string;
  unit: string;
  dp: number;
  better: Better;
  derived?: 'sd';
  base?: string;
}

const METRICS: Metric[] = [
  { key: 'carry', label: 'Carry', unit: 'yd', dp: 1, better: 'up' },
  { key: 'total', label: 'Total', unit: 'yd', dp: 1, better: 'up' },
  { key: 'bs', label: 'Ball Speed', unit: 'mph', dp: 1, better: 'up' },
  { key: 'apex', label: 'Apex', unit: 'ft', dp: 1, better: 'neutral' },
  { key: 'la', label: 'Launch Angle', unit: '°', dp: 1, better: 'neutral' },
  { key: 'spin', label: 'Spin', unit: 'rpm', dp: 0, better: 'neutral' },
  { key: 'carrySd', label: 'Carry Consistency', unit: 'yd SD', dp: 1, better: 'down', derived: 'sd', base: 'carry' },
  { key: 'devSd', label: 'Lateral Spread', unit: 'yd SD', dp: 1, better: 'down', derived: 'sd', base: 'dev' },
  { key: 'dev', label: 'Lateral Bias', unit: 'yd', dp: 1, better: 'zero' },
];

// tone palette (web --good / --bad / neutral)
const TONE = { good: '#7CFFA0', bad: '#ff9d9d', flat: C.dim2 };
const HEALTH = { good: '#7fd4ff', bad: '#ff9d9d', neutral: '#5e7568' };

type SeriePoint = { session: string; label: string; value: number; n: number };
type Classify = {
  dir: 'up' | 'down' | 'flat';
  sig: boolean;
  delta: number;
  first: number;
  last: number;
};

// ---------------------------------------------------------------------------
// Pure computation layer (mirrors the web functions, parameterised by data +
// the global sessState so it stays pure for memoization).
// ---------------------------------------------------------------------------
type SessState = Record<string, boolean>; // session id -> shown (false = excluded)

function makeCompute(SHOTS: RawShot[], SESSIONS: Session[], sessState: SessState) {
  const shown = (sid: string) => sessState[sid] !== false;

  // build per-session aggregate for a club+metric
  function series(club: string, m: Metric): SeriePoint[] {
    const out: SeriePoint[] = [];
    SESSIONS.forEach((s) => {
      if (!shown(s.id)) return;
      const k = m.base || m.key;
      const vals = SHOTS.filter(
        (x) =>
          x.club === club &&
          x.session === s.id &&
          !(x as RawShot & { excluded?: boolean }).excluded &&
          (x as any)[k] !== undefined &&
          (x as any)[k] !== null,
      ).map((x) => (x as any)[k] as number);
      if (!vals.length) return;
      const v = m.derived === 'sd' ? sd(vals) : mean(vals);
      out.push({ session: s.id, label: s.label, value: v, n: vals.length });
    });
    return out;
  }

  // classify a change as meaningful or not (ported from classify2)
  function classify2(serie: SeriePoint[], m: Metric, club: string): Classify {
    if (serie.length < 2) return { dir: 'flat', sig: false, delta: 0, first: 0, last: 0 };
    const first = serie[0].value;
    const last = serie[serie.length - 1].value;
    const d = last - first;
    const k = m.base || m.key;
    const allv = SHOTS.filter(
      (x) => x.club === club && shown(x.session) && (x as any)[k] !== undefined && (x as any)[k] !== null,
    ).map((x) => (x as any)[k] as number);
    let thresh: number;
    if (m.derived === 'sd') {
      thresh = Math.max(first * 0.15, 0.8); // >15% change in spread, min 0.8 yd
    } else if (m.better === 'zero') {
      thresh = 2.0; // ~2 yd shift in average miss is a real aim change
    } else {
      const noise = (sd(allv) / Math.sqrt(Math.max(1, serie[0].n))) * 1.6;
      thresh = Math.max(noise, Math.abs(first) * 0.02);
    }
    const sig = Math.abs(d) > thresh;
    return {
      dir: Math.abs(d) < 1e-9 ? 'flat' : d > 0 ? 'up' : 'down',
      sig,
      delta: d,
      first,
      last,
    };
  }

  // overall health signal per club (for the indicator dots)
  function clubHealth(club: string): 'good' | 'bad' | 'neutral' {
    const dirMetrics = METRICS.filter((m) => m.better === 'up' || m.better === 'down');
    let good = 0;
    let bad = 0;
    let counted = 0;
    dirMetrics.forEach((m) => {
      const se = series(club, m);
      if (se.length < 2) return;
      const c = classify2(se, m, club);
      if (!c.sig) return;
      counted++;
      if (c.dir === m.better) good++;
      else bad++;
    });
    if (counted === 0) return 'neutral';
    if (good > bad) return 'good';
    if (bad > good) return 'bad';
    return 'neutral';
  }

  // WHY did carry change? Runs every REAL shot through the engine, averages those
  // carries per session (so the total matches the trend line), then attributes the
  // change to ball speed / launch / spin + a "consistency" remainder.
  function carryAttribution(club: string) {
    const has = (sid: string) =>
      SHOTS.some((x) => x.club === club && x.session === sid && !(x as RawShot & { excluded?: boolean }).excluded);
    const sess = SESSIONS.filter((s) => shown(s.id) && has(s.id));
    if (sess.length < 2) return null;
    const shotsFor = (sid: string) =>
      SHOTS.filter(
        (x) =>
          x.club === club &&
          x.session === sid &&
          !(x as RawShot & { excluded?: boolean }).excluded &&
          x.bs != null &&
          x.la != null &&
          x.spin != null,
      ).map((x) => ({ bs: x.bs as number, la: x.la as number, spin: x.spin as number }));
    const SA = shotsFor(sess[0].id);
    const SB = shotsFor(sess[sess.length - 1].id);
    if (!SA.length || !SB.length) return null;
    let r;
    try {
      r = attributeAvgCarryChange(SA, SB);
    } catch {
      return null;
    }
    return { A: r.A, B: r.B, r, firstLabel: sess[0].label, lastLabel: sess[sess.length - 1].label };
  }

  return { series, classify2, clubHealth, carryAttribution };
}

// tone for a classified metric (good = moving the better way / centering)
function toneFor(m: Metric, c: Classify): 'good' | 'bad' | 'flat' {
  if (!c.sig) return 'flat';
  if (m.better === 'up' || m.better === 'down') return c.dir === m.better ? 'good' : 'bad';
  if (m.better === 'zero') return Math.abs(c.last) < Math.abs(c.first) ? 'good' : 'bad';
  return 'flat';
}

// ===========================================================================
// SVG chart components
// ===========================================================================

// Metric-over-time line chart (ported geometry from lineChart())
function LineChart({ serie, m, color }: { serie: SeriePoint[]; m: Metric; color: string }) {
  const W = 720;
  const H = 240;
  if (serie.length < 1) {
    return <Text style={styles.empty}>No data for this metric.</Text>;
  }
  const pad = { l: 46, r: 18, t: 20, b: 34 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const vals = serie.map((p) => p.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const padv = (hi - lo) * 0.18;
  lo -= padv;
  hi += padv;
  const X = (i: number) => pad.l + (serie.length === 1 ? iw / 2 : (i / (serie.length - 1)) * iw);
  const Y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;

  const grid = [];
  for (let k = 0; k <= 4; k++) {
    const gy = pad.t + (k / 4) * ih;
    const gv = hi - (k / 4) * (hi - lo);
    grid.push(
      <G key={`g${k}`}>
        <Line x1={pad.l} y1={gy} x2={W - pad.r} y2={gy} stroke="#142219" />
        <SvgText x={pad.l - 8} y={gy + 3} fill={C.dim2} fontSize={9} fontFamily="monospace" textAnchor="end">
          {gv.toFixed(m.dp)}
        </SvgText>
      </G>,
    );
  }
  const path = serie.map((p, i) => (i ? 'L' : 'M') + X(i) + ' ' + Y(p.value)).join(' ');

  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H * 0.72}>
      {grid}
      <Path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
      {serie.map((p, i) => (
        <G key={`d${i}`}>
          <Circle cx={X(i)} cy={Y(p.value)} r={4.5} fill={color} />
          <SvgText x={X(i)} y={Y(p.value) - 10} fill={C.ink} fontSize={11} fontFamily="monospace" textAnchor="middle">
            {fmt(p.value, m.dp)}
          </SvgText>
          <SvgText x={X(i)} y={H - 12} fill={C.dim} fontSize={9.5} fontFamily="monospace" textAnchor="middle">
            {p.label}
          </SvgText>
          <SvgText x={X(i)} y={H - 2} fill={C.dim2} fontSize={8} fontFamily="monospace" textAnchor="middle">
            n={p.n}
          </SvgText>
        </G>
      ))}
    </Svg>
  );
}

// nice step helper (ported)
function niceStep(range: number, target: number) {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const mm of [1, 2, 2.5, 5, 10]) if (p * mm >= raw) return p * mm;
  return p * 10;
}

type Pt = [number, number];

// ===========================================================================
// Attribution panel (ported from attributionPanel())
// ===========================================================================
function AttributionPanel({
  club,
  color,
  compute,
}: {
  club: string;
  color: string;
  compute: ReturnType<typeof makeCompute>;
}) {
  const at = compute.carryAttribution(club);
  if (!at) return null;
  const { A, B, r } = at;
  const parts: { label: string; d: number; from?: number; to?: number; unit?: string; dp?: number; sub?: string }[] = [
    { label: 'Ball speed', d: r.parts.ballSpeed, from: A.ballSpeedMph, to: B.ballSpeedMph, unit: 'mph', dp: 1 },
    { label: 'Launch angle', d: r.parts.launch, from: A.launchDeg, to: B.launchDeg, unit: '°', dp: 1 },
    { label: 'Spin', d: r.parts.spin, from: A.spinRpm, to: B.spinRpm, unit: 'rpm', dp: 0 },
    { label: 'Strike consistency', d: r.parts.consistency, sub: 'shot-to-shot contact & shot mix' },
  ];
  const maxAbs = Math.max(...parts.map((p) => Math.abs(p.d)), 0.1);
  const sign = (x: number) => (x > 0 ? '+' : '');
  const col = (d: number) => (Math.abs(d) < 0.3 ? C.dim : d > 0 ? C.accent2 : C.bad);
  const totCol = Math.abs(r.total) < 0.3 ? C.dim : r.total > 0 ? C.accent2 : C.bad;

  return (
    <View style={styles.panel}>
      <Text style={[styles.h2, { color }]}>Why {club}'s carry changed</Text>
      <Text style={styles.hint}>FIRST SESSION → LATEST · PHYSICS ATTRIBUTION VIA DRAG + MAGNUS FLIGHT MODEL</Text>
      {Math.abs(r.total) < 0.5 ? (
        <Text style={styles.attrLead}>
          Carry is essentially unchanged ({sign(r.total)}
          {r.total.toFixed(1)} yd). The parts below mostly cancel out.
        </Text>
      ) : (
        <Text style={styles.attrLead}>
          Your carry {r.total > 0 ? 'gained' : 'lost'}{' '}
          <Text style={{ color: totCol, fontWeight: '700' }}>
            {sign(r.total)}
            {r.total.toFixed(1)} yd
          </Text>{' '}
          between the first and latest session — the same change shown on the chart. Here&apos;s what
          the physics model says drove it:
        </Text>
      )}
      <View style={{ gap: 11, marginTop: 4 }}>
        {parts.map((p) => {
          const w = (Math.abs(p.d) / maxAbs) * 100;
          const pos = p.d >= 0;
          const c = col(p.d);
          return (
            <View key={p.label} style={styles.attrRow}>
              <View style={styles.attrName}>
                <Text style={styles.attrNameText}>{p.label}</Text>
                <Text style={styles.attrSub}>
                  {p.sub != null ? p.sub : `${fmt(p.from, p.dp)} → ${fmt(p.to, p.dp)} ${p.unit}`}
                </Text>
              </View>
              <View style={styles.attrTrack}>
                <View
                  style={[
                    styles.attrFill,
                    { width: `${w}%`, backgroundColor: c },
                    pos ? { left: 0 } : { right: 0 },
                  ]}
                />
              </View>
              <Text style={[styles.attrVal, { color: c }]}>
                {sign(p.d)}
                {p.d.toFixed(1)} yd
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ===========================================================================
// MAIN SCREEN
// ===========================================================================
export default function Trends() {
  const { shots, sessions, colors, clubOrder, loading } = useRawData();

  // GLOBAL session state — persists across club switches; false = excluded.
  const [sessState, setSessState] = useState<SessState>({});
  const [current, setCurrent] = useState<string | null>(null);
  const [activeMetric, setActiveMetric] = useState('carry');
  const [sessModal, setSessModal] = useState(false);
  const [clubModal, setClubModal] = useState(false);
  const inited = useRef(false);
  const sessInited = useRef(false);

  // default every session to shown once sessions arrive from the hook.
  useEffect(() => {
    if (sessInited.current || !sessions.length) return;
    sessInited.current = true;
    const keep = new Set(sessions.slice(-10).map((s) => s.id)); // default: the last 10 sessions
    const st: SessState = {};
    sessions.forEach((s) => {
      st[s.id] = keep.has(s.id);
    });
    setSessState(st);
  }, [sessions]);

  const orderIdx = (c: string) => {
    const i = clubOrder.indexOf(c);
    return i < 0 ? 999 : i;
  };
  const clubsWithData = useMemo(
    () => [...new Set(shots.map((s) => s.club))].sort((a, b) => orderIdx(a) - orderIdx(b)),
    [shots, clubOrder],
  );

  // default-select the club tracked across the MOST sessions, so the trend +
  // carry-change attribution are meaningful out of the box (not an empty club).
  useEffect(() => {
    if (!inited.current && clubsWithData.length) {
      inited.current = true;
      const sessionsPerClub: Record<string, Set<string>> = {};
      shots.forEach((s) => {
        (sessionsPerClub[s.club] ||= new Set<string>()).add(s.session);
      });
      const best = [...clubsWithData].sort(
        (a, b) => (sessionsPerClub[b]?.size ?? 0) - (sessionsPerClub[a]?.size ?? 0),
      )[0];
      setCurrent(best ?? clubsWithData[0]);
    }
  }, [clubsWithData, shots]);

  // Use ENGINE-computed carry/total/apex/lateral so Trends agrees with the Bag /
  // Club Detail / 2D / 3D (all engine-modeled). The R50's own measured carry is
  // preserved as `measuredCarry` for the "why carry changed" reference note.
  const engineShots = useMemo(
    () =>
      shots.map((s) => {
        const out: RawShot & { measuredCarry?: number } = { ...s, measuredCarry: s.carry };
        if (s.bs != null && s.la != null && s.spin != null) {
          try {
            const r = simulateFlight(
              { ballSpeedMph: s.bs, launchDeg: s.la, spinRpm: s.spin, axisDeg: s.axis || 0, directionDeg: s.ld || 0 },
              { rollout: true },
            );
            out.carry = Math.round(r.carryYd * 10) / 10;
            out.total = Math.round((r.totalYd ?? r.carryYd) * 10) / 10;
            out.apex = Math.round(r.apexFt * 10) / 10;
            out.dev = Math.round(r.lateralYd * 10) / 10;
          } catch {
            /* keep R50 values if the sim fails */
          }
        }
        return out;
      }),
    [shots],
  );
  const compute = useMemo(
    () => makeCompute(engineShots, sessions, sessState),
    [engineShots, sessions, sessState],
  );

  const toggleSession = (id: string) =>
    setSessState((prev) => ({ ...prev, [id]: prev[id] === false }));
  const applyPreset = (p: 'all' | 'none' | 'last5' | 'last10' | 'last30') =>
    setSessState(() => {
      const st: SessState = {};
      if (p === 'all') sessions.forEach((s) => { st[s.id] = true; });
      else if (p === 'none') sessions.forEach((s) => { st[s.id] = false; });
      else if (p === 'last5' || p === 'last10') {
        const k = p === 'last5' ? 5 : 10;
        const keep = new Set(sessions.slice(-k).map((s) => s.id)); // sessions are oldest→newest
        sessions.forEach((s) => { st[s.id] = keep.has(s.id); });
      } else {
        const times = sessions.map((s) => Date.parse(s.date ?? '')).filter((t) => !Number.isNaN(t));
        const latest = times.length ? Math.max(...times) : 0;
        const cutoff = latest - 30 * 86400000;
        sessions.forEach((s) => {
          const t = Date.parse(s.date ?? '');
          st[s.id] = Number.isNaN(t) ? true : t >= cutoff;
        });
      }
      return st;
    });
  const sessSel = sessions.filter((s) => sessState[s.id] !== false).length;
  const sessSummary =
    sessSel === sessions.length
      ? `All ${sessions.length} sessions`
      : sessSel === 0
        ? 'No sessions selected'
        : `${sessSel} of ${sessions.length} sessions`;

  if (loading) {
    return (
      <View style={[styles.page, styles.center]}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  if (shots.length === 0) {
    return (
      <View style={[styles.page, styles.center]}>
        <Text style={styles.emptyTitle}>No shots yet</Text>
        <Text style={styles.emptyDim}>Upload a session on the Raw tab to get started.</Text>
      </View>
    );
  }

  const color = current ? colors[current] || C.accent : C.accent;

  // ----- render content for the selected club -----
  let content: React.ReactNode = null;
  if (!current) {
    content = (
      <View style={styles.panel}>
        <Text style={styles.empty}>No shot data found.</Text>
      </View>
    );
  } else {
    const sessForClub = sessions.filter(
      (s) => sessState[s.id] !== false && shots.some((x) => x.club === current && x.session === s.id),
    );
    if (sessForClub.length < 2) {
      const totalForClub = sessions.filter((s) =>
        shots.some((x) => x.club === current && x.session === s.id),
      ).length;
      const msg =
        totalForClub < 2
          ? `Only ${totalForClub} session has data for this club — need at least 2 to show a trend. Log another range session and upload it on the Raw Data page.`
          : `Only ${sessForClub.length} of this club's ${totalForClub} sessions are selected — pick at least 2 sessions above to compare.`;
      content = (
        <View style={styles.panel}>
          <Text style={[styles.h2, { color }]}>{current}</Text>
          <Text style={styles.empty}>{msg}</Text>
        </View>
      );
    } else {
      // insight cards — top movers
      const cardKeys = ['carry', 'bs', 'carrySd', 'devSd', 'apex', 'dev'];
      const cards = METRICS.filter((m) => cardKeys.includes(m.key))
        .map((m) => {
          const se = compute.series(current!, m);
          if (se.length < 2) return null;
          const c = compute.classify2(se, m, current!);
          const tone = toneFor(m, c);
          const arrow = c.dir === 'up' ? '▲' : c.dir === 'down' ? '▼' : '■';
          const verdict = !c.sig
            ? 'within normal variation'
            : m.better === 'down'
              ? c.dir === 'down'
                ? 'tightened — improving'
                : 'loosened — watch this'
              : m.better === 'up'
                ? c.dir === 'up'
                  ? 'gaining'
                  : 'dropping off'
                : 'shifted';
          const toneCol = c.sig ? TONE[tone] : C.dim;
          return (
            <View
              key={m.key}
              style={[styles.ins, { borderLeftColor: c.sig ? TONE[tone] : C.line2 }]}>
              <Text style={styles.insName}>{m.label}</Text>
              <Text style={[styles.insDelta, { color: toneCol }]}>
                {arrow} {fmt(c.delta, m.dp, true)} <Text style={styles.insUnit}>{m.unit}</Text>
              </Text>
              <Text style={styles.insDesc}>
                {fmt(c.first, m.dp)} → {fmt(c.last, m.dp)} · {verdict}
              </Text>
            </View>
          );
        })
        .filter(Boolean);

      // metric chart, colored by selected metric's tone
      const am = METRICS.find((m) => m.key === activeMetric)!;
      const se = compute.series(current!, am);
      let lineColor = color;
      if (se.length >= 2) {
        const cc = compute.classify2(se, am, current!);
        const t = toneFor(am, cc);
        if (t === 'good') lineColor = TONE.good;
        else if (t === 'bad') lineColor = TONE.bad;
      }


      content = (
        <>
          {/* attribution — the value: WHY carry changed, leads the page */}
          <AttributionPanel club={current!} color={color} compute={compute} />

          {/* insight cards */}
          <View style={styles.insights}>{cards}</View>

          {/* metric over time */}
          <View style={styles.panel}>
            <Text style={[styles.h2, { color }]}>{current} — Metric Over Time</Text>
            <Text style={styles.hint}>SELECTED SESSIONS · DOTS SHOW SESSION AVERAGE · n = SHOTS THAT SESSION</Text>
            <View style={styles.metricSel}>
              {METRICS.map((m) => {
                const on = m.key === activeMetric;
                return (
                  <TouchableOpacity
                    key={m.key}
                    onPress={() => setActiveMetric(m.key)}
                    style={[styles.msel, on && styles.mselOn]}>
                    <Text style={[styles.mselText, on && styles.mselTextOn]}>{m.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <LineChart serie={se} m={am} color={lineColor} />
          </View>


          {/* all-metrics table */}
          <View style={styles.panel}>
            <Text style={styles.h2}>
              All Metrics: First vs Latest{' '}
              <Text style={styles.h2Sub}>(of selected)</Text>
            </Text>
            <Text style={styles.hint}>● = MEANINGFUL CHANGE · ○ = WITHIN NORMAL SESSION NOISE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View>
                <View style={[styles.tr, styles.theadRow]}>
                  <Text style={[styles.th, styles.thLeft, { width: 150 }]}>Metric</Text>
                  <Text style={[styles.th, { width: 78 }]}>First</Text>
                  <Text style={[styles.th, { width: 78 }]}>Latest</Text>
                  <Text style={[styles.th, { width: 78 }]}>Δ</Text>
                  <Text style={[styles.th, { width: 50 }]}>Sig</Text>
                </View>
                {METRICS.map((m) => {
                  const s2 = compute.series(current!, m);
                  if (s2.length < 2) return null;
                  const c = compute.classify2(s2, m, current!);
                  const tone = toneFor(m, c);
                  const dColor = c.sig ? TONE[tone] : C.dim2;
                  return (
                    <View key={m.key} style={[styles.tr, styles.tbodyRow]}>
                      <Text style={[styles.td, styles.tdLeft, { width: 150 }]}>
                        {m.label} <Text style={{ color: C.dim2 }}>{m.unit}</Text>
                      </Text>
                      <Text style={[styles.td, { width: 78 }]}>{fmt(c.first, m.dp)}</Text>
                      <Text style={[styles.td, { width: 78 }]}>{fmt(c.last, m.dp)}</Text>
                      <Text style={[styles.td, { width: 78, color: dColor }]}>
                        {fmt(c.delta, m.dp, true)}
                      </Text>
                      <Text style={[styles.td, { width: 50, color: dColor }]}>{c.sig ? '●' : '○'}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
            <Text style={styles.note}>
              "Meaningful" compares the change against this club's shot-to-shot scatter, so a 2-yard carry bump on a club
              that swings ±8 yards won't get flagged, but a real tightening of your dispersion will.
            </Text>
          </View>
        </>
      );
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <Text style={styles.kicker}>WHAT CHANGED — AND WHY</Text>
      <Text style={styles.title}>
        Performance <Text style={styles.titleAccent}>Analytics</Text>
      </Text>
      <Text style={styles.lead}>
        Not just how your numbers moved session to session — why. Pick a club and every carry change is traced to its
        cause: ball speed, launch, or spin.
      </Text>

      {/* legend */}
      <View style={styles.legend}>
        <LegendDot color="#7fd4ff" label="improving" glow />
        <LegendDot color="#5e7568" label="steady" />
        <LegendDot color="#ff9d9d" label="needs a look" glow />
      </View>

      {/* GLOBAL session selector — compact summary opens a picker sheet (scales to many sessions) */}
      <View style={styles.sessWrap}>
        <Text style={styles.sessLabel}>COMPARE SESSIONS</Text>
        <TouchableOpacity style={styles.sessSummary} onPress={() => setSessModal(true)}>
          <Text style={styles.sessSummaryText}>{sessSummary}</Text>
          <Text style={styles.sessChevron}>▾</Text>
        </TouchableOpacity>
      </View>
      <Modal visible={sessModal} transparent animationType="slide" onRequestClose={() => setSessModal(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSessModal(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Compare sessions</Text>
          <View style={styles.presetsRow}>
            {(
              [
                ['All', 'all'],
                ['Last 5', 'last5'],
                ['Last 10', 'last10'],
                ['Last 30 days', 'last30'],
                ['None', 'none'],
              ] as const
            ).map(([lbl, p]) => (
              <TouchableOpacity key={p} style={[styles.schip, styles.schipMini]} onPress={() => applyPreset(p)}>
                <Text style={[styles.schipText, { color: C.accent2 }]}>{lbl}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView style={styles.sheetList}>
            {[...sessions].reverse().map((s) => {
              const on = sessState[s.id] !== false;
              const n = shots.filter((x) => x.session === s.id).length;
              return (
                <TouchableOpacity key={s.id} style={styles.sessRow} onPress={() => toggleSession(s.id)}>
                  <View style={[styles.checkbox, on && { backgroundColor: C.accent2, borderColor: C.accent2 }]}>
                    {on ? <Text style={styles.checkmark}>✓</Text> : null}
                  </View>
                  <Text style={[styles.sessRowLabel, { color: on ? C.ink : C.dim }]} numberOfLines={1}>
                    {s.label}
                    {s._uploaded ? ' •' : ''}
                  </Text>
                  <Text style={styles.sessRowCount}>{n} shots</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity style={styles.sheetDone} onPress={() => setSessModal(false)}>
            <Text style={styles.sheetDoneText}>Done</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* club selector — compact summary opens a single-select picker (tap a club = pick + close, no Done) */}
      <View style={styles.sessWrap}>
        <Text style={styles.sessLabel}>CLUB</Text>
        <TouchableOpacity style={styles.sessSummary} onPress={() => setClubModal(true)}>
          {current ? <View style={[styles.clubDot, { backgroundColor: HEALTH[compute.clubHealth(current)] }]} /> : null}
          <Text style={styles.sessSummaryText}>{current ?? 'Select a club'}</Text>
          <Text style={styles.sessChevron}>▾</Text>
        </TouchableOpacity>
      </View>
      <Modal visible={clubModal} transparent animationType="slide" onRequestClose={() => setClubModal(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setClubModal(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Club</Text>
          <ScrollView style={styles.sheetList}>
            {clubsWithData.map((club) => {
              const on = club === current;
              const h = compute.clubHealth(club);
              const n = new Set(shots.filter((x) => x.club === club).map((x) => x.session)).size;
              return (
                <TouchableOpacity
                  key={club}
                  style={styles.sessRow}
                  onPress={() => {
                    setCurrent(club);
                    setClubModal(false);
                  }}>
                  <View style={[styles.clubDot, { backgroundColor: HEALTH[h] }]} />
                  <Text
                    style={[styles.sessRowLabel, { color: on ? C.ink : C.dim, fontWeight: on ? '700' : '400' }]}
                    numberOfLines={1}>
                    {club}
                  </Text>
                  <Text style={styles.sessRowCount}>
                    {n} session{n === 1 ? '' : 's'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {content}

      <View style={styles.foot}>
        <Text style={styles.footText}>ABSHERMETRICS · performance analytics</Text>
        <Text style={styles.footText}>{sessions.length} sessions</Text>
      </View>
    </ScrollView>
  );
}

function LegendDot({ color, label, glow }: { color: string; label: string; glow?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.legendDot,
          { backgroundColor: color },
          glow ? { shadowColor: color, shadowOpacity: 0.9, shadowRadius: 4, elevation: 3 } : null,
        ]}
      />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const mono = 'monospace';
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  pageContent: { padding: 16, paddingBottom: 56 },
  center: { alignItems: 'center', justifyContent: 'center' },

  kicker: { fontFamily: mono, fontSize: 11, letterSpacing: 3, color: C.accent },
  title: { fontSize: 40, fontWeight: '800', color: C.ink, marginTop: 8, letterSpacing: 0.5 },
  titleAccent: { color: C.accent },
  lead: { fontSize: 15, color: C.dim, marginTop: 10, lineHeight: 22 },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontFamily: mono, fontSize: 11, color: C.dim },

  sessWrap: { marginTop: 16 },
  sessLabel: { fontFamily: mono, fontSize: 10, letterSpacing: 1, color: C.dim2, marginBottom: 8 },
  schip: { borderWidth: 1, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 11 },
  schipMini: { borderColor: '#2a4a52', paddingHorizontal: 9 },
  schipText: { fontFamily: mono, fontSize: 11 },
  sessSummary: { flexDirection: 'row', alignItems: 'center', gap: 9, alignSelf: 'flex-start', backgroundColor: C.bg2, borderWidth: 1, borderColor: C.line2, borderRadius: 18, paddingVertical: 9, paddingHorizontal: 14 },
  sessSummaryText: { fontFamily: mono, fontSize: 12, color: C.ink },
  sessChevron: { fontFamily: mono, fontSize: 10, color: C.dim2 },
  sheetBackdrop: { flex: 1, backgroundColor: '#000000aa' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%', backgroundColor: C.bg2, borderTopWidth: 1, borderColor: C.line2, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 28 },
  sheetHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 3, backgroundColor: C.line2, marginBottom: 12 },
  sheetTitle: { fontFamily: mono, fontSize: 11, letterSpacing: 1, color: C.dim2, marginBottom: 12, textTransform: 'uppercase' },
  presetsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  sheetList: { maxHeight: 360 },
  sessRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9, paddingHorizontal: 4 },
  checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: C.line2, alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#0a120d', fontSize: 12, fontWeight: '700' },
  sessRowLabel: { flex: 1, fontFamily: mono, fontSize: 12 },
  sessRowCount: { fontFamily: mono, fontSize: 10, color: C.dim2 },
  sheetDone: { marginTop: 12, alignSelf: 'flex-start', backgroundColor: C.accent2, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 20 },
  sheetDoneText: { fontFamily: mono, fontSize: 11, letterSpacing: 1, color: '#0a120d', fontWeight: '600', textTransform: 'uppercase' },

  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14, marginBottom: 4 },
  pchip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 13,
  },
  pchipText: { fontFamily: mono, fontSize: 12 },
  hdot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 7 },
  clubDot: { width: 10, height: 10, borderRadius: 5 },

  insights: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 18, marginBottom: 4 },
  ins: {
    flexGrow: 1,
    minWidth: 150,
    flexBasis: '46%',
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.line,
    borderLeftWidth: 3,
    borderRadius: 12,
    padding: 14,
  },
  insName: { fontFamily: mono, fontSize: 10, letterSpacing: 1, color: C.dim2, textTransform: 'uppercase' },
  insDelta: { fontSize: 30, fontWeight: '800', marginTop: 4 },
  insUnit: { fontSize: 14, color: C.dim, fontWeight: '400' },
  insDesc: { fontSize: 13, color: C.dim, marginTop: 4, lineHeight: 18 },

  panel: {
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    padding: 16,
    marginTop: 18,
  },
  h2: { fontSize: 23, fontWeight: '800', color: C.ink, letterSpacing: 0.5 },
  h2Sub: { fontSize: 13, color: C.dim2, fontWeight: '400' },
  hint: { fontFamily: mono, fontSize: 10, color: C.dim2, letterSpacing: 0.5, marginTop: 2, marginBottom: 12 },

  metricSel: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  msel: { borderWidth: 1, borderColor: C.line2, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 11, backgroundColor: C.bg2 },
  mselOn: { backgroundColor: C.accent, borderColor: C.accent },
  mselText: { fontFamily: mono, fontSize: 11, color: C.dim },
  mselTextOn: { color: '#0a120d', fontWeight: '600' },

  flightRow: { flexDirection: 'row', gap: 14, marginTop: 6, alignItems: 'stretch' },
  fv: {
    backgroundColor: '#0b1410',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  fvTop: { alignItems: 'center' },
  fvLbl: { fontFamily: mono, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: C.dim2, marginBottom: 4 },

  attrLead: { fontSize: 14.5, color: C.dim, marginBottom: 12, lineHeight: 22 },
  attrRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  attrName: { width: 110 },
  attrNameText: { fontFamily: mono, fontSize: 12, color: C.ink, lineHeight: 16 },
  attrSub: { fontFamily: mono, fontSize: 10, color: C.dim2, marginTop: 2 },
  attrTrack: {
    flex: 1,
    height: 10,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  attrFill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 6 },
  attrVal: { fontFamily: mono, fontSize: 13, width: 66, textAlign: 'right' },

  // table
  tr: { flexDirection: 'row', alignItems: 'center' },
  theadRow: { borderBottomWidth: 1, borderBottomColor: C.line2, paddingVertical: 8 },
  tbodyRow: { borderBottomWidth: 1, borderBottomColor: '#142219' },
  th: {
    fontFamily: mono,
    fontSize: 9.5,
    letterSpacing: 0.5,
    color: C.dim2,
    textTransform: 'uppercase',
    textAlign: 'right',
    paddingHorizontal: 10,
  },
  thLeft: { textAlign: 'left' },
  td: { fontFamily: mono, fontSize: 12, color: C.dim, textAlign: 'right', paddingHorizontal: 10, paddingVertical: 9 },
  tdLeft: { textAlign: 'left' },

  empty: { padding: 24, textAlign: 'center', color: C.dim, fontFamily: mono, fontSize: 13 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: C.ink, textAlign: 'center' },
  emptyDim: { fontSize: 13, color: C.dim, fontFamily: mono, textAlign: 'center', marginTop: 8 },
  note: { fontFamily: mono, fontSize: 12, color: C.dim, marginTop: 12, lineHeight: 18 },

  foot: {
    marginTop: 40,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: C.line,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  footText: { fontFamily: mono, fontSize: 11, color: C.dim2 },
});
