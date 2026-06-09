import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Circle, Line, Rect, Svg, Text as SvgText } from 'react-native-svg';

import AverageShot, { type LaunchMeans } from '@/components/AverageShot';
import { type ClubData } from '@/data';
import { useClubs } from '@/lib/dataStore';
import { fmt, mean, sd } from '@/lib/format';
import { C } from '@/theme';

// --- per-shot engine result shape (shots.json `derived` field) ---
interface Derived {
  carry?: number;
  total?: number;
  apex?: number;
  descent?: number;
  dev?: number;
  devTotal?: number;
}

// One merged per-shot row: launch inputs (R50) + engine-derived results.
interface Shot {
  bs: number;
  la: number;
  ld: number;
  spin: number;
  axis: number;
  bspin: number;
  sspin: number;
  carry: number;
  total: number;
  apex: number;
  dev: number;
  _n: number;
}

type ShotKey = keyof Shot;

const METRICS: { key: ShotKey; label: string; unit: string; dp: number; signed?: boolean }[] = [
  { key: 'carry', label: 'Carry', unit: 'yd', dp: 1 },
  { key: 'total', label: 'Total', unit: 'yd', dp: 1 },
  { key: 'bs', label: 'Ball Speed', unit: 'mph', dp: 1 },
  { key: 'la', label: 'Launch Angle', unit: '°', dp: 1 },
  { key: 'ld', label: 'Launch Dir', unit: '°', dp: 1, signed: true },
  { key: 'spin', label: 'Spin', unit: 'rpm', dp: 0 },
  { key: 'bspin', label: 'Backspin', unit: 'rpm', dp: 0 },
  { key: 'sspin', label: 'Sidespin', unit: 'rpm', dp: 0, signed: true },
  { key: 'axis', label: 'Spin Axis', unit: '°', dp: 1, signed: true },
  { key: 'apex', label: 'Apex', unit: 'ft', dp: 1 },
  { key: 'dev', label: 'Lateral Dev', unit: 'yd', dp: 1, signed: true },
];

const SHOT_COLS: { k: ShotKey | '_n'; label: string; w: number; dp?: number; signed?: boolean }[] = [
  { k: '_n', label: '#', w: 40 },
  { k: 'carry', label: 'Carry', w: 64 },
  { k: 'total', label: 'Total', w: 64 },
  { k: 'bs', label: 'Ball', w: 60 },
  { k: 'la', label: 'Launch', w: 64 },
  { k: 'spin', label: 'Spin', w: 70, dp: 0 },
  { k: 'apex', label: 'Apex', w: 60 },
  { k: 'dev', label: 'Lat', w: 60, signed: true },
  { k: 'axis', label: 'Axis', w: 60, signed: true },
];

// Merge stats (launch inputs) + derived (engine results), exactly like web's `S`.
function buildShots(d: ClubData): Shot[] {
  const stats = (d.stats || []) as any[];
  const derived = (d.derived || []) as Derived[];
  const pick = (a: number | undefined, b: number | undefined) =>
    a != null ? a : b != null ? b : 0;
  return stats.map((st, i) => {
    const e = derived[i] || {};
    return {
      bs: st.bs ?? 0,
      la: st.la ?? 0,
      ld: st.ld ?? 0,
      spin: st.spin ?? 0,
      axis: st.axis ?? 0,
      bspin: st.bspin ?? 0,
      sspin: st.sspin ?? 0,
      carry: pick(e.carry, st.carry),
      total: pick(e.total, st.total),
      apex: pick(e.apex, st.apex),
      dev: pick(e.dev, st.dev),
      _n: i + 1,
    };
  });
}

// ---- Carry histogram (SVG bars + dashed mean line) ----
function Histogram({ vals, color }: { vals: number[]; color: string }) {
  const W = 460;
  const H = 190;
  const pad = { l: 34, r: 14, t: 14, b: 30 };
  if (!vals.length) return null;
  const n = vals.length;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const bins = Math.max(5, Math.min(12, Math.round(Math.sqrt(n))));
  const bw = span / bins;
  const counts = new Array(bins).fill(0);
  vals.forEach((v) => {
    let bi = Math.floor((v - lo) / bw);
    if (bi >= bins) bi = bins - 1;
    if (bi < 0) bi = 0;
    counts[bi]++;
  });
  const maxC = Math.max(...counts);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (i / bins) * iw;
  const bwpx = iw / bins;
  const m = mean(vals);
  const mx = pad.l + ((m - lo) / span) * iw;
  const labX = (v: number) => pad.l + ((v - lo) / span) * iw;

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* baseline */}
      <Line x1={pad.l} y1={pad.t + ih} x2={W - pad.r} y2={pad.t + ih} stroke={C.line2} />
      {counts.map((c, i) => {
        const h = maxC ? (c / maxC) * ih : 0;
        return (
          <Rect
            key={i}
            x={x(i) + 1.5}
            y={pad.t + ih - h}
            width={bwpx - 3}
            height={h}
            rx={2}
            fill={color}
            opacity={0.82}
          />
        );
      })}
      {counts.map((c, i) =>
        c ? (
          <SvgText
            key={`c${i}`}
            x={x(i) + bwpx / 2}
            y={pad.t + ih - (maxC ? (c / maxC) * ih : 0) - 4}
            fill={C.dim}
            fontSize={9}
            fontFamily="monospace"
            textAnchor="middle">
            {String(c)}
          </SvgText>
        ) : null,
      )}
      {/* mean line + label */}
      <Line
        x1={mx}
        y1={pad.t}
        x2={mx}
        y2={pad.t + ih}
        stroke={C.accent2}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <SvgText
        x={mx}
        y={pad.t - 2}
        fill={C.accent2}
        fontSize={9}
        fontFamily="monospace"
        textAnchor="middle">
        {`μ ${m.toFixed(0)}`}
      </SvgText>
      {/* x labels: lo, mid, hi */}
      {[lo, lo + span / 2, hi].map((v, i) => (
        <SvgText
          key={`l${i}`}
          x={labX(v)}
          y={H - 10}
          fill={C.dim2}
          fontSize={9}
          fontFamily="monospace"
          textAnchor="middle">
          {v.toFixed(0)}
        </SvgText>
      ))}
    </Svg>
  );
}

// ---- Top-down dispersion scatter (lateral × carry) ----
function Dispersion({ shots, color }: { shots: Shot[]; color: string }) {
  const W = 460;
  const H = 300;
  const pad = 30;
  if (!shots.length) return null;
  const carries = shots.map((s) => s.carry);
  const devs = shots.map((s) => s.dev);
  const cLo = Math.min(...carries);
  const cHi = Math.max(...carries);
  const dMax = Math.max(10, Math.max(...devs.map(Math.abs)));
  const iw = W - pad * 2;
  const ih = H - pad * 2;
  const X = (dv: number) => pad + iw / 2 + (dv / (dMax * 1.1)) * (iw / 2);
  const cSpan = cHi - cLo || 1;
  const Y = (c: number) => pad + ih - ((c - cLo) / cSpan) * ih * 0.92 - 6;
  const ms = mean(devs);
  const ds = sd(devs);
  const cMean = mean(carries);

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* center line */}
      <Line
        x1={pad + iw / 2}
        y1={pad}
        x2={pad + iw / 2}
        y2={pad + ih}
        stroke={C.line}
        strokeDasharray="3 4"
      />
      {/* ±1σ lateral band */}
      <Rect
        x={X(ms - ds)}
        y={pad}
        width={X(ms + ds) - X(ms - ds)}
        height={ih}
        fill={color}
        opacity={0.06}
      />
      {/* shots */}
      {shots.map((s, i) => (
        <Circle key={i} cx={X(s.dev)} cy={Y(s.carry)} r={3.4} fill={color} opacity={0.7} />
      ))}
      {/* mean ring */}
      <Circle cx={X(ms)} cy={Y(cMean)} r={5} fill="none" stroke={C.accent2} strokeWidth={2} />
      {/* labels */}
      <SvgText x={pad} y={pad - 10} fill={C.dim2} fontSize={9} fontFamily="monospace">
        {'← left   carry ↑   right →'}
      </SvgText>
      <SvgText
        x={pad + iw / 2}
        y={H - 8}
        fill={C.dim2}
        fontSize={9}
        fontFamily="monospace"
        textAnchor="middle">
        lateral spread (yd)
      </SvgText>
    </Svg>
  );
}

// ---- Consistency bars (lower coefficient of variation = tighter = greener) ----
function ConsistencyBars({ shots }: { shots: Shot[] }) {
  const items: { nm: string; k: ShotKey }[] = [
    { nm: 'Carry', k: 'carry' },
    { nm: 'Ball Speed', k: 'bs' },
    { nm: 'Launch', k: 'la' },
    { nm: 'Spin', k: 'spin' },
    { nm: 'Apex', k: 'apex' },
  ];
  return (
    <View>
      {items.map((it) => {
        const v = shots.map((s) => s[it.k] as number);
        const m = mean(v);
        const s = sd(v);
        const cv = m ? (s / Math.abs(m)) * 100 : 0;
        const tight = Math.max(0, Math.min(100, 100 - (cv / 15) * 100));
        const hue = tight > 66 ? C.accent : tight > 33 ? '#e8d44f' : C.bad;
        return (
          <View key={it.nm} style={styles.crow}>
            <Text style={styles.crowNm}>{it.nm.toUpperCase()}</Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${tight}%`, backgroundColor: hue }]} />
            </View>
            <Text style={styles.crowVv}>
              ±{s.toFixed(cv < 1 ? 2 : 1)} <Text style={styles.crowVvDim}>{cv.toFixed(1)}%</Text>
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function ClubDetail() {
  const { clubs, loading } = useClubs();
  // Web default = DATA[0] (shots.json is ascending by club length → first item).
  const [current, setCurrent] = useState<string>('');
  const [sortKey, setSortKey] = useState<ShotKey | '_n'>('carry');
  const [sortDir, setSortDir] = useState<number>(-1);

  // Once clubs load, default the selected club to the first one (web default = DATA[0]).
  const selected = current || clubs[0]?.club || '';

  const d = useMemo(() => clubs.find((c) => c.club === selected), [clubs, selected]);

  // mean launch for the engine-computed Average Shot views
  const launch = useMemo<LaunchMeans | null>(() => {
    if (!d) return null;
    const m = (k: string) => mean(d.stats.map((s) => (s as any)[k]).filter((v: any) => v != null) as number[]);
    return { bs: m('bs'), la: m('la'), spin: m('spin'), axis: m('axis') || 0, ld: m('ld') || 0 };
  }, [d]);

  const view = useMemo(() => {
    if (!d) return null;
    const S = buildShots(d);
    const carries = S.map((s) => s.carry);
    const totals = S.map((s) => s.total);
    const devs = S.map((s) => s.dev);
    const apexes = S.map((s) => s.apex);
    const spins = S.map((s) => s.spin);
    const cMean = mean(carries);
    const cSd = sd(carries);
    // bag context: rank by engine carry, longest = #1
    const sortedByCarry = [...clubs].sort((a, b) => b.carry - a.carry);
    const rank = sortedByCarry.findIndex((c) => c.club === selected) + 1;
    return { S, carries, totals, devs, apexes, spins, cMean, cSd, rank };
  }, [d, clubs, selected]);

  const sortedShots = useMemo(() => {
    if (!view) return [];
    const arr = [...view.S];
    arr.sort((a, b) => {
      if (sortKey === '_n') return (a._n - b._n) * sortDir;
      return ((a[sortKey] as number) - (b[sortKey] as number)) * sortDir;
    });
    return arr;
  }, [view, sortKey, sortDir]);

  const onSort = (k: ShotKey | '_n') => {
    if (sortKey === k) setSortDir((dir) => dir * -1);
    else {
      setSortKey(k);
      setSortDir(k === '_n' ? 1 : -1);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  if (clubs.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No shots yet</Text>
        <Text style={styles.emptySub}>Upload a session on the Raw tab to get started.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      {/* club picker chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.picker}>
        {clubs.map((c) => {
          const on = c.club === selected;
          return (
            <Pressable
              key={c.club}
              onPress={() => setCurrent(c.club)}
              style={[
                styles.pchip,
                on
                  ? { backgroundColor: c.color, borderColor: c.color }
                  : { backgroundColor: C.bg2, borderColor: C.line2 },
              ]}>
              <Text style={[styles.pchipText, on ? styles.pchipTextOn : null]}>{c.club}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {d && view ? (
        <>
          {/* hero title */}
          <View style={styles.clubhead}>
            <Text style={[styles.big, { color: d.color }]}>{d.club}</Text>
          </View>
          <Text style={styles.subline}>
            {d.n} shots · {fmt(view.cMean, 0)} yd carry · loft-ordered #{view.rank} of {clubs.length}
          </Text>

          {/* headline cards */}
          <View style={styles.hstrip}>
            <HCard
              v={fmt(view.cMean, 0)}
              unit=" yd"
              label="Avg Carry"
              sub={`±${fmt(view.cSd, 1)} yd spread`}
            />
            <HCard
              v={fmt(mean(view.totals), 0)}
              unit=" yd"
              label="Avg Total"
              sub={`${fmt(mean(view.totals) - view.cMean, 1, true)} roll`}
            />
            <HCard
              v={fmt(mean(view.apexes), 0)}
              unit=" ft"
              label="Avg Apex"
              sub={`${fmt(mean(view.S.map((s) => s.la)), 1)}° launch`}
            />
            <HCard
              v={fmt(mean(view.spins), 0)}
              label="Avg Spin (rpm)"
              sub={`${fmt(mean(view.S.map((s) => s.axis)), 1)}° axis`}
            />
            <HCard v={String(view.S.length)} label="Shots" sub={`#${view.rank} longest in bag`} />
          </View>

          {/* Average shot (engine-computed, animated) — moved here from Trends */}
          <AverageShot club={d.club} color={d.color} launch={launch} />

          {/* Carry Distribution */}
          <View style={styles.panel}>
            <Text style={styles.panelH2}>Carry Distribution</Text>
            <Text style={styles.hint}>HOW TIGHTLY CARRIES CLUSTER · DASHED = MEAN</Text>
            <Histogram vals={view.carries} color={d.color} />
            <Text style={styles.cap}>
              carry (yd) — {view.S.length} shots, {fmt(Math.min(...view.carries), 0)}–
              {fmt(Math.max(...view.carries), 0)} yd
            </Text>
          </View>

          {/* Shot Dispersion */}
          <View style={styles.panel}>
            <Text style={styles.panelH2}>Shot Dispersion</Text>
            <Text style={styles.hint}>TOP-DOWN LANDING PATTERN · RING = MEAN</Text>
            <Dispersion shots={view.S} color={d.color} />
            <Text style={styles.cap}>
              lateral ±{fmt(sd(view.devs), 1)} yd · carry ±{fmt(view.cSd, 1)} yd
            </Text>
          </View>

          {/* Consistency */}
          <View style={styles.panel}>
            <Text style={styles.panelH2}>Consistency</Text>
            <Text style={styles.hint}>LONGER + GREENER = MORE REPEATABLE (LOWER VARIATION)</Text>
            <ConsistencyBars shots={view.S} />
          </View>

          {/* Full Metrics */}
          <View style={styles.panel}>
            <Text style={styles.panelH2}>Full Metrics</Text>
            <Text style={styles.hint}>EVERY R50 FIELD · MEAN / SD / MIN / MAX / RANGE</Text>
            <MetricTable shots={view.S} />
          </View>

          {/* Every Shot */}
          <View style={styles.panel}>
            <Text style={styles.panelH2}>Every Shot</Text>
            <Text style={styles.hint}>TAP A HEADER TO SORT</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tscroll}>
              <View>
                <View style={[styles.tr, styles.shotHeadRow]}>
                  {SHOT_COLS.map((c) => {
                    const active = sortKey === c.k;
                    return (
                      <Pressable key={c.k} onPress={() => onSort(c.k)} style={{ width: c.w }}>
                        <Text
                          style={[
                            styles.sth,
                            c.k === '_n' ? styles.left : styles.right,
                            active ? styles.sthActive : null,
                          ]}>
                          {c.label}
                          {active ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {sortedShots.map((s) => (
                  <View key={s._n} style={[styles.tr, styles.shotRow]}>
                    {SHOT_COLS.map((c) => {
                      if (c.k === '_n') {
                        return (
                          <Text
                            key={c.k}
                            style={[styles.std, styles.stdFirst, styles.left, { width: c.w }]}>
                            {s._n}
                          </Text>
                        );
                      }
                      const dp = c.dp === undefined ? 1 : c.dp;
                      const num = s[c.k] as number;
                      const neg = c.signed && num < 0;
                      return (
                        <Text
                          key={c.k}
                          style={[styles.std, styles.right, { width: c.w }, neg ? styles.neg : null]}>
                          {fmt(num, dp, c.signed)}
                        </Text>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          <View style={styles.foot}>
            <Text style={styles.footText}>ABSHERMETRICS · per-club analysis</Text>
            <Text style={styles.footText}>Garmin Approach R50 · physics-derived dispersion</Text>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function HCard({ v, unit, label, sub }: { v: string; unit?: string; label: string; sub: string }) {
  return (
    <View style={styles.hcard}>
      <Text style={styles.hcardV}>
        {v}
        {unit ? <Text style={styles.hcardSmall}>{unit}</Text> : null}
      </Text>
      <Text style={styles.hcardL}>{label.toUpperCase()}</Text>
      <Text style={styles.hcardSub}>{sub}</Text>
    </View>
  );
}

function MetricTable({ shots }: { shots: Shot[] }) {
  const COLS = [
    { key: 'metric', label: 'Metric', w: 130, left: true },
    { key: 'mean', label: 'Mean', w: 66 },
    { key: 'sd', label: 'SD', w: 60 },
    { key: 'min', label: 'Min', w: 60 },
    { key: 'max', label: 'Max', w: 60 },
    { key: 'range', label: 'Range', w: 60 },
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tscroll}>
      <View>
        <View style={[styles.tr, styles.mHeadRow]}>
          {COLS.map((c) => (
            <Text
              key={c.key}
              style={[styles.mth, { width: c.w }, c.left ? styles.left : styles.right]}>
              {c.label}
            </Text>
          ))}
        </View>
        {METRICS.map((m) => {
          const v = shots.map((s) => s[m.key] as number);
          const mn = mean(v);
          const s = sd(v);
          const lo = Math.min(...v);
          const hi = Math.max(...v);
          const negCls = (x: number) => !!m.signed && x < 0;
          return (
            <View key={m.key} style={[styles.tr, styles.mRow]}>
              <Text style={[styles.mtdLabel, { width: COLS[0].w }, styles.left]}>
                {m.label} <Text style={styles.mtdUnit}>{m.unit}</Text>
              </Text>
              <Text
                style={[
                  styles.mtd,
                  styles.right,
                  styles.mtdMean,
                  { width: COLS[1].w },
                  m.signed && mn < 0 ? styles.neg : null,
                ]}>
                {fmt(mn, m.dp, m.signed)}
              </Text>
              <Text style={[styles.mtd, styles.right, { width: COLS[2].w }]}>{fmt(s, m.dp)}</Text>
              <Text
                style={[styles.mtd, styles.right, { width: COLS[3].w }, negCls(lo) ? styles.neg : null]}>
                {fmt(lo, m.dp, m.signed)}
              </Text>
              <Text
                style={[styles.mtd, styles.right, { width: COLS[4].w }, negCls(hi) ? styles.neg : null]}>
                {fmt(hi, m.dp, m.signed)}
              </Text>
              <Text style={[styles.mtd, styles.right, { width: COLS[5].w }]}>{fmt(hi - lo, m.dp)}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const mono = 'monospace';
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  pageContent: { padding: 16, paddingBottom: 48 },
  center: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.ink },
  emptySub: { fontFamily: mono, fontSize: 13, color: C.dim, marginTop: 8, textAlign: 'center' },
  kicker: { fontFamily: mono, fontSize: 11, letterSpacing: 3, color: C.accent },

  // picker
  picker: { gap: 7, paddingVertical: 14, paddingRight: 8 },
  pchip: { borderWidth: 1, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 13 },
  pchipText: { fontFamily: mono, fontSize: 12, color: C.dim },
  pchipTextOn: { color: '#0a120d', fontWeight: '600' },

  // hero
  clubhead: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 6 },
  big: { fontSize: 64, fontWeight: '800', letterSpacing: 1 },
  subline: { fontFamily: mono, fontSize: 12, color: C.dim, letterSpacing: 1, marginTop: 2 },

  // headline cards
  hstrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18, marginBottom: 4 },
  hcard: {
    flexGrow: 1,
    flexBasis: 130,
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  hcardV: { fontFamily: 'System', fontSize: 36, fontWeight: '800', color: C.accent, lineHeight: 38 },
  hcardSmall: { fontSize: 16, color: C.dim, fontWeight: '600' },
  hcardL: { fontFamily: mono, fontSize: 10, letterSpacing: 1, color: C.dim2, marginTop: 6 },
  hcardSub: { fontSize: 13, color: C.dim, marginTop: 3 },

  // panels
  panel: {
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    padding: 18,
    marginTop: 16,
  },
  panelH2: { fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: 0.5 },
  hint: {
    fontFamily: mono,
    fontSize: 10,
    color: C.dim2,
    letterSpacing: 0.5,
    marginTop: 2,
    marginBottom: 12,
  },
  cap: {
    fontFamily: mono,
    fontSize: 10,
    color: C.dim2,
    marginTop: 8,
    textAlign: 'center',
    letterSpacing: 0.5,
  },

  // consistency bars
  crow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 9 },
  crowNm: {
    fontFamily: mono,
    fontSize: 11,
    color: C.dim,
    width: 92,
    letterSpacing: 0.5,
  },
  bar: { flex: 1, height: 8, backgroundColor: '#10201766', borderRadius: 5, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5 },
  crowVv: { fontFamily: mono, fontSize: 11, color: C.ink, width: 80, textAlign: 'right' },
  crowVvDim: { color: C.dim2 },

  // shared table
  tr: { flexDirection: 'row', alignItems: 'center' },
  left: { textAlign: 'left' },
  right: { textAlign: 'right' },
  neg: { color: C.bad },
  tscroll: { marginTop: 2 },

  // metric table
  mHeadRow: { borderBottomWidth: 1, borderBottomColor: C.line2, paddingBottom: 7 },
  mth: {
    fontFamily: mono,
    fontSize: 9.5,
    letterSpacing: 0.5,
    color: C.dim2,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  mRow: { borderBottomWidth: 1, borderBottomColor: '#142219' },
  mtdLabel: {
    fontFamily: mono,
    fontSize: 11,
    color: C.dim,
    letterSpacing: 0.5,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  mtdUnit: { color: C.dim2 },
  mtd: { fontFamily: mono, fontSize: 13.5, color: C.ink, paddingHorizontal: 8, paddingVertical: 8 },
  mtdMean: { color: C.accent, fontWeight: '600', fontSize: 15 },

  // shot table
  shotHeadRow: { borderBottomWidth: 1, borderBottomColor: C.line2, paddingBottom: 8 },
  sth: {
    fontFamily: mono,
    fontSize: 9,
    letterSpacing: 0.5,
    color: C.dim2,
    paddingHorizontal: 9,
    paddingTop: 8,
  },
  sthActive: { color: C.accent },
  shotRow: { borderBottomWidth: 1, borderBottomColor: '#142219' },
  std: { fontFamily: mono, fontSize: 13, color: C.ink, paddingHorizontal: 9, paddingVertical: 7 },
  stdFirst: { color: C.dim2, fontSize: 10 },

  // footer
  foot: { marginTop: 30, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.line, gap: 6 },
  footText: { fontFamily: mono, fontSize: 11, color: C.dim2 },
});
