import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  type DimensionValue,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Line, Polyline, Rect, Svg } from 'react-native-svg';

import BackBar from '@/components/BackBar';
import Bounded from '@/components/Bounded';
import { buildSummary, loadBagSummary, type BagSummaryClub } from '@/lib/bagSummary';
import { clubSortIdx } from '@/lib/clubData';
import { useConnections } from '@/lib/connections';
import { useClubs } from '@/lib/dataStore';
import { useProfile } from '@/lib/profile';
import { C } from '@/theme';

const YOU = C.accent; // '#d4ff4f'
const THEM = C.accent2 ?? '#7fd4ff';
const mono = 'monospace';

const byClub = (s: BagSummaryClub[]) => {
  const m: Record<string, BagSummaryClub> = {};
  s.forEach((c) => (m[c.club] = c));
  return m;
};
const pts = (mean: number[]) => {
  const p: number[][] = [];
  for (let i = 0; i + 2 < mean.length; i += 3) p.push([mean[i], mean[i + 1], mean[i + 2]]);
  return p;
};

export default function Compare() {
  const params = useLocalSearchParams<{ u?: string | string[] }>();
  const initialU = Array.isArray(params.u) ? params.u[0] : params.u;

  const { accepted } = useConnections();
  const { clubs } = useClubs();
  const profile = useProfile();

  const mine = useMemo(() => buildSummary(clubs, profile.clubSpecs), [clubs, profile.clubSpecs]);
  const myName = (profile.displayName || '').trim() || 'You';

  const [activeId, setActiveId] = useState<string | undefined>(initialU);
  const [theirs, setTheirs] = useState<BagSummaryClub[]>([]);
  const [theirName, setTheirName] = useState('Connection');
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const [trajClub, setTrajClub] = useState<string | null>(null);

  // default/validate selection: fall back to the first accepted connection if the
  // current id isn't an accepted connection (e.g. a stale or unknown ?u= param).
  useEffect(() => {
    if (!accepted.length) return;
    if (!accepted.some((c) => c.other.id === activeId)) setActiveId(accepted[0].other.id);
  }, [accepted, activeId]);

  // load the selected connection's bag
  useEffect(() => {
    let alive = true;
    if (!activeId) return;
    const conn = accepted.find((c) => c.other.id === activeId);
    setTheirName(conn?.other.name || conn?.other.email?.split('@')[0] || 'Connection');
    setLoading(true);
    setMissing(false);
    setTrajClub(null);
    loadBagSummary(activeId).then((res) => {
      if (!alive) return;
      setTheirs(res.summary || []);
      setMissing(!res.summary?.length);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [activeId, accepted]);

  const my = useMemo(() => byClub(mine), [mine]);
  const th = useMemo(() => byClub(theirs), [theirs]);
  const unionClubs = useMemo(
    () =>
      [...new Set([...mine.map((c) => c.club), ...theirs.map((c) => c.club)])].sort(
        (a, b) => clubSortIdx(a) - clubSortIdx(b),
      ),
    [mine, theirs],
  );
  const bothClubs = useMemo(
    () => unionClubs.filter((c) => my[c]?.mean?.length && th[c]?.mean?.length),
    [unionClubs, my, th],
  );
  const selClub = trajClub ?? bothClubs[0] ?? null;

  // carry domain for the ladder
  const domain = useMemo(() => {
    const cs: number[] = [];
    unionClubs.forEach((c) => {
      if (my[c]) cs.push(my[c].carry);
      if (th[c]) cs.push(th[c].carry);
    });
    if (!cs.length) return { lo: 0, hi: 1 };
    const lo = Math.min(...cs);
    const hi = Math.max(...cs);
    const pad = Math.max(1, (hi - lo) * 0.08);
    return { lo: lo - pad, hi: hi + pad };
  }, [unionClubs, my, th]);
    const pct = (v: number) => ((v - domain.lo) / (domain.hi - domain.lo)) * 100;
  const pc = (n: number) => `${n}%` as DimensionValue;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Bounded>
      <BackBar label="Bag" />
      <Text style={styles.kicker}>COMPARE</Text>
      <Text style={styles.title}>
        You <Text style={styles.vs}>vs</Text> {theirName}
      </Text>
      <Text style={styles.lead}>
        Your bag overlaid against a connection&apos;s — both are aggregate summaries; neither sees
        the other&apos;s raw shots.
      </Text>

      {accepted.length === 0 ? (
        <Text style={styles.msg}>
          You have no connections yet. Add one in Settings → Connections, then come back to compare
          bags.
        </Text>
      ) : mine.length === 0 ? (
        <Text style={styles.msg}>
          Upload a session first (no clubs in your own bag yet) — then you can compare it against a
          connection.
        </Text>
      ) : (
        <>
          {/* connection picker */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            {accepted.map((c) => {
              const name = c.other.name || c.other.email?.split('@')[0] || 'Player';
              const on = c.other.id === activeId;
              return (
                <Pressable
                  key={c.other.id}
                  onPress={() => setActiveId(c.other.id)}
                  style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={C.accent} size="large" />
            </View>
          ) : missing ? (
            <Text style={styles.msg}>{theirName} hasn&apos;t shared any club data yet.</Text>
          ) : (
            <>
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View style={[styles.sw, { backgroundColor: YOU }]} />
                  <Text style={styles.legendTxt}>{myName}</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.sw, { backgroundColor: THEM }]} />
                  <Text style={styles.legendTxt}>{theirName}</Text>
                </View>
              </View>

              {/* GAPPING LADDER (dumbbell rows) */}
              <Text style={styles.h2}>GAPPING LADDER</Text>
              <Text style={styles.sub}>carry per club, both bags on one yardage scale</Text>
              <View style={styles.panel}>
                {unionClubs.map((c) => {
                  const me = my[c]?.carry;
                  const them = th[c]?.carry;
                  const d = me != null && them != null ? me - them : null;
                  const lo = me != null && them != null ? Math.min(pct(me), pct(them)) : null;
                  const hi = me != null && them != null ? Math.max(pct(me), pct(them)) : null;
                  return (
                    <View key={c} style={styles.ladderRow}>
                      <Text style={styles.ladderClub} numberOfLines={1}>
                        {c}
                      </Text>
                      <View style={styles.track}>
                        <View style={styles.trackBase} />
                        {lo != null && hi != null && (
                          <View style={[styles.connector, { left: pc(lo), width: pc(hi - lo) }]} />
                        )}
                        {me != null && (
                          <View style={[styles.dot, { left: pc(pct(me)), backgroundColor: YOU }]} />
                        )}
                        {them != null && (
                          <View style={[styles.dot, { left: pc(pct(them)), backgroundColor: THEM }]} />
                        )}
                      </View>
                      <Text
                        style={[
                          styles.ladderDelta,
                          d == null ? styles.dim : d > 0 ? styles.pos : d < 0 ? styles.neg : styles.dim,
                        ]}>
                        {d == null ? '—' : `${d > 0 ? '+' : ''}${d}`}
                      </Text>
                    </View>
                  );
                })}
                <Text style={styles.axisNote}>carry (yd) · left = shorter, right = longer</Text>
              </View>

              {/* PER-CLUB DELTAS (carry + total, matches web) */}
              <Text style={styles.h2}>PER-CLUB DELTAS</Text>
              <Text style={styles.sub}>carry &amp; total: you vs theirs (+ = you&apos;re longer) · swipe →</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator style={styles.panel}>
                <View>
                  <View style={[styles.tr, styles.trHead]}>
                    <Text style={[styles.th, styles.colClubF]}>Club</Text>
                    <Text style={[styles.th, styles.colNumF]}>You car</Text>
                    <Text style={[styles.th, styles.colNumF]}>Them car</Text>
                    <Text style={[styles.th, styles.colNumF]}>Δ</Text>
                    <Text style={[styles.th, styles.colNumF]}>You tot</Text>
                    <Text style={[styles.th, styles.colNumF]}>Them tot</Text>
                    <Text style={[styles.th, styles.colNumF]}>Δ</Text>
                  </View>
                  {unionClubs.map((c) => {
                    const meC = my[c]?.carry ?? null;
                    const themC = th[c]?.carry ?? null;
                    const meT = my[c]?.total ?? null;
                    const themT = th[c]?.total ?? null;
                    const dC = meC != null && themC != null ? meC - themC : null;
                    const dT = meT != null && themT != null ? meT - themT : null;
                    const dSty = (d: number | null) =>
                      d == null ? styles.dim : d > 0 ? styles.pos : d < 0 ? styles.neg : styles.dim;
                    const dTxt = (d: number | null) => (d == null ? '—' : `${d > 0 ? '+' : ''}${d}`);
                    return (
                      <View key={c} style={styles.tr}>
                        <Text style={[styles.tdClub, styles.colClubF]} numberOfLines={1}>
                          {c}
                        </Text>
                        <Text style={[styles.td, styles.colNumF, { color: YOU }]}>{meC ?? '—'}</Text>
                        <Text style={[styles.td, styles.colNumF, { color: THEM }]}>{themC ?? '—'}</Text>
                        <Text style={[styles.td, styles.colNumF, dSty(dC)]}>{dTxt(dC)}</Text>
                        <Text style={[styles.td, styles.colNumF, { color: YOU }]}>{meT ?? '—'}</Text>
                        <Text style={[styles.td, styles.colNumF, { color: THEM }]}>{themT ?? '—'}</Text>
                        <Text style={[styles.td, styles.colNumF, dSty(dT)]}>{dTxt(dT)}</Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>

              {/* AVERAGE BALL FLIGHT */}
              <Text style={styles.h2}>AVERAGE BALL FLIGHT</Text>
              <Text style={styles.sub}>your mean trajectory vs theirs, for one club</Text>
              {bothClubs.length === 0 ? (
                <View style={styles.panel}>
                  <Text style={styles.dimMsg}>No clubs in common with trajectory data yet.</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.trajLabel}>CLUB</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
                    {bothClubs.map((c) => {
                      const on = c === selClub;
                      return (
                        <Pressable
                          key={c}
                          onPress={() => setTrajClub(c)}
                          style={[styles.chipSm, on && styles.chipOn]}>
                          <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{c}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  {selClub && my[selClub] && th[selClub] && (
                    <TrajPair me={my[selClub]} them={th[selClub]} />
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      </Bounded>
    </ScrollView>
  );
}

function TrajPair({ me, them }: { me: BagSummaryClub; them: BagSummaryClub }) {
  const a = pts(me.mean);
  const b = pts(them.mean);
  const all = a.concat(b);
  const xMax = Math.max(...all.map((p) => p[0]), 1);
  const yMax = Math.max(...all.map((p) => p[1]), 1);
  const zMax = Math.max(...all.map((p) => Math.abs(p[2])), 1);
  const W = Math.min(Dimensions.get('window').width - 64, 480);
  const H = 200;
  const pad = 18;
  const X = (t: number) => pad + t * (W - 2 * pad);
  const sideY = (t: number) => H - pad - t * (H - 2 * pad);
  const topY = (t: number) => H / 2 + t * (H / 2 - pad);

  const sidePts = (p: number[][]) => p.map((q) => `${X(q[0] / xMax)},${sideY(q[1] / yMax)}`).join(' ');
  const topPts = (p: number[][]) => p.map((q) => `${X(q[0] / xMax)},${topY(q[2] / zMax)}`).join(' ');

  return (
    <>
      <Text style={styles.trajLabel}>SIDE · downrange × height</Text>
      <View style={styles.panel}>
        <Svg width={W} height={H}>
          <Rect x={0} y={0} width={W} height={H} fill="#081109" rx={8} />
          <Line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#1d3327" strokeWidth={1} />
          <Polyline points={sidePts(a)} fill="none" stroke={YOU} strokeWidth={2.5} />
          <Polyline points={sidePts(b)} fill="none" stroke={THEM} strokeWidth={2.5} />
        </Svg>
      </View>
      <Text style={styles.trajLabel}>TOP-DOWN · downrange × lateral</Text>
      <View style={styles.panel}>
        <Svg width={W} height={H}>
          <Rect x={0} y={0} width={W} height={H} fill="#081109" rx={8} />
          <Line
            x1={pad}
            y1={H / 2}
            x2={W - pad}
            y2={H / 2}
            stroke="#1d3327"
            strokeWidth={1}
            strokeDasharray="3 4"
          />
          <Polyline points={topPts(a)} fill="none" stroke={YOU} strokeWidth={2.5} />
          <Polyline points={topPts(b)} fill="none" stroke={THEM} strokeWidth={2.5} />
        </Svg>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 18, paddingBottom: 48 },
  kicker: { fontFamily: mono, fontSize: 11, letterSpacing: 2, color: C.accent, marginTop: 6 },
  title: { fontSize: 32, fontWeight: '800', color: C.ink, marginTop: 8, letterSpacing: 0.5 },
  vs: { color: C.accent2 },
  lead: { fontSize: 14, color: C.dim, marginTop: 10, lineHeight: 20 },
  msg: { fontFamily: mono, fontSize: 13, color: C.dim, marginTop: 26, lineHeight: 20 },
  dimMsg: { fontFamily: mono, fontSize: 12, color: C.dim2, paddingVertical: 8 },
  center: { paddingVertical: 50, alignItems: 'center' },

  chips: { flexDirection: 'row', marginTop: 18, marginBottom: 4 },
  chip: { borderWidth: 1, borderColor: C.line2, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginRight: 8, backgroundColor: C.bg2 },
  chipSm: { borderWidth: 1, borderColor: C.line2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, backgroundColor: C.bg2 },
  chipOn: { backgroundColor: C.accent2, borderColor: C.accent2 },
  chipTxt: { fontFamily: mono, fontSize: 13, color: C.dim },
  chipTxtOn: { color: '#0a120d', fontWeight: '700' },

  legend: { flexDirection: 'row', gap: 18, marginTop: 18, marginBottom: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  sw: { width: 12, height: 12, borderRadius: 3, marginRight: 6 },
  legendTxt: { fontFamily: mono, fontSize: 12, color: C.dim },

  h2: { fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: 0.5, marginTop: 24 },
  sub: { fontFamily: mono, fontSize: 11, color: C.dim, marginTop: 2, marginBottom: 10 },
  panel: { borderWidth: 1, borderColor: C.line, borderRadius: 12, backgroundColor: C.bg2, padding: 14 },

  ladderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  ladderClub: { width: 78, color: C.ink, fontWeight: '700', fontSize: 13 },
  track: { flex: 1, height: 16, justifyContent: 'center', position: 'relative', marginHorizontal: 8 },
  trackBase: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#142219' },
  connector: { position: 'absolute', height: 2, backgroundColor: C.line2, top: 7 },
  dot: { position: 'absolute', width: 11, height: 11, borderRadius: 6, marginLeft: -5.5, top: 2.5 },
  ladderDelta: { width: 52, textAlign: 'right', fontFamily: mono, fontSize: 12 },
  axisNote: { fontFamily: mono, fontSize: 10, color: C.dim2, marginTop: 8, textAlign: 'center' },

  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#142219' },
  trHead: { borderBottomColor: C.line },
  th: { fontFamily: mono, fontSize: 10, letterSpacing: 0.5, color: C.dim2, textTransform: 'uppercase' },
  td: { fontFamily: mono, fontSize: 14, color: C.dim },
  tdClub: { color: C.ink, fontWeight: '700', fontSize: 14 },
  colClub: { flex: 1, textAlign: 'left' },
  colNum: { width: 58, textAlign: 'right' },
  colClubF: { width: 92, textAlign: 'left' },
  colNumF: { width: 64, textAlign: 'right' },

  pos: { color: C.accent },
  neg: { color: C.bad },
  dim: { color: C.dim2 },

  trajLabel: { fontFamily: mono, fontSize: 11, letterSpacing: 1, color: C.dim2, textTransform: 'uppercase', marginTop: 12, marginBottom: 6 },
});
