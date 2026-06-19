import { Link, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Bounded from '@/components/Bounded';
import { type ClubData } from '@/data';
import { useClubs, useData, useDataActions } from '@/lib/dataStore';
import { useProfile } from '@/lib/profile';
import { ABBR, C, RED } from '@/theme';

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const comma = (x: number) => Math.round(x).toLocaleString('en-US');

type Col = { key: string; label: string; w: number; left?: boolean; accent?: boolean };
const COLS: Col[] = [
  { key: 'club', label: 'Club', w: 140, left: true },
  { key: 'loft', label: 'Loft', w: 64 },
  { key: 'carry', label: 'Carry', w: 62, accent: true },
  { key: 'total', label: 'Total', w: 58 },
  { key: 'ball', label: 'Ball', w: 54 },
  { key: 'launch', label: 'Launch', w: 68 },
  { key: 'apex', label: 'Apex', w: 56 },
];

interface Row {
  club: string;
  loft: string;
  carry: number;
  total: number;
  apex: number;
  sd: number;
  lat: number;
  ball: number;
  launch: number;
  spin: number;
  red: boolean;
}

function buildRows(clubs: ClubData[], getLoft: (club: string) => number | null) {
  // clubs is ascending by length; the table shows longest first.
  const disp = [...clubs].reverse();
  const rows: Row[] = disp.map((c) => {
    const col = (k: 'bs' | 'la' | 'spin') =>
      c.stats.map((s) => s[k]).filter((v): v is number => v != null);
    const lf = getLoft(c.club);
    return {
      club: c.club,
      loft: lf != null ? `${lf}°` : '–',
      carry: c.carry, // engine values, baked into shots.json
      total: c.total,
      apex: c.apex,
      sd: c.ell ? c.ell.rx : 0,
      lat: c.ell ? c.ell.rz : 0,
      ball: Math.round(mean(col('bs'))), // R50 launch inputs
      launch: Math.round(mean(col('la')) * 10) / 10,
      spin: Math.round(mean(col('spin'))),
      red: RED.has(c.club),
    };
  });
  const carries = rows.map((r) => r.carry);
  const longest = Math.max(...carries);
  const shortest = Math.min(...carries);
  return {
    rows,
    longest,
    shortest,
    longClub: rows.find((r) => r.carry === longest)!.club,
    shortClub: rows.find((r) => r.carry === shortest)!.club,
    nClubs: clubs.length,
    totalShots: clubs.reduce((s, c) => s + c.stats.length, 0),
  };
}

function cellText(row: Row, key: string): string {
  switch (key) {
    case 'club':
      return row.club;
    case 'loft':
      return row.loft;
    case 'carry':
      return String(row.carry);
    case 'total':
      return String(row.total);
    case 'apex':
      return String(row.apex);
    case 'ball':
      return String(row.ball);
    case 'launch':
      return r1(row.launch) + '°';
    case 'spin':
      return comma(row.spin);
    case 'sd':
      return '±' + r1(row.sd);
    case 'lat':
      return '±' + r1(row.lat);
    default:
      return '';
  }
}

export default function Overview() {
  const { clubs, loading } = useClubs();
  const { error, refresh } = useData();
  const { getLoft } = useProfile();
  const { loadSampleData } = useDataActions();
  const [seeding, setSeeding] = useState(false);
  const [seedErr, setSeedErr] = useState<string | null>(null);
  const ab = (c: string) => ABBR[c] ?? c;

  const d = useMemo(() => (clubs.length ? buildRows(clubs, getLoft) : null), [clubs, getLoft]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  // A real load attempt finished but failed — show an error + retry, never the
  // "load sample data" offer (which must only appear for a confirmed-empty account).
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Couldn’t load your data</Text>
        <Text style={styles.emptyDim}>{error}</Text>
        <Pressable onPress={() => void refresh()} style={styles.sampleBtn}>
          <Text style={styles.sampleBtnTxt}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!d) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No shots yet</Text>
        <Text style={styles.emptyDim}>
          Upload a CSV from Settings → Raw shot data, or load sample data to explore the app.
        </Text>
        <Pressable
          onPress={async () => {
            setSeeding(true);
            setSeedErr(null);
            const { error } = await loadSampleData();
            setSeeding(false);
            if (error) setSeedErr(error);
          }}
          style={styles.sampleBtn}
          disabled={seeding}>
          {seeding ? (
            <ActivityIndicator color="#0a120d" />
          ) : (
            <Text style={styles.sampleBtnTxt}>Load sample data</Text>
          )}
        </Pressable>
        {seedErr ? <Text style={styles.seedErr}>{seedErr}</Text> : null}
      </View>
    );
  }

  const stats = [
    { v: d.longest, l: `Longest carry (${ab(d.longClub)})` },
    { v: d.shortest, l: `Shortest carry (${ab(d.shortClub)})` },
    { v: d.nClubs, l: 'Clubs tracked' },
    { v: d.totalShots, l: 'Shots analyzed' },
  ];

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <Bounded>
      <Text style={styles.kicker}>
        LAUNCH-MONITOR ANALYSIS · {d.nClubs} CLUBS · {d.totalShots} SHOTS
      </Text>
      <Text style={styles.title}>
        MY <Text style={styles.titleAccent}>BAG</Text>, BY THE NUMBERS
      </Text>
      <Text style={styles.lead}>
        Every carry, gap, and miss pattern from my range sessions — modeled through real
        ball-flight physics. TaylorMade P7MB blades through the bag.
      </Text>

      <View style={styles.statStrip}>
        {stats.map((s) => (
          <View key={s.l} style={styles.stat}>
            <Text style={styles.statV}>{s.v}</Text>
            <Text style={styles.statL}>{s.l}</Text>
          </View>
        ))}
      </View>

      <Link href={'/compare' as Href} style={styles.compareBtn}>
        ⚖ Compare with a connection →
      </Link>

      <View style={styles.tableHead}>
        <Text style={styles.tableTitle}>CLUB SUMMARY</Text>
        <Text style={styles.tableSub}>carry & gapping · averages per club · swipe →</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableWrap}>
        <View>
          {/* header */}
          <View style={[styles.tr, styles.headRow]}>
            {COLS.map((c) => (
              <Text
                key={c.key}
                numberOfLines={1}
                style={[styles.th, { width: c.w }, c.left ? styles.left : styles.right]}>
                {c.label}
              </Text>
            ))}
          </View>

          {d.rows.map((row, idx) => (
            <View key={row.club} style={styles.groupRow}>
              <View style={styles.tr}>
                {COLS.map((c) => {
                  const isClub = c.key === 'club';
                  const redLat = c.key === 'lat' && row.red;
                  return (
                    <Text
                      key={c.key}
                      numberOfLines={1}
                      style={[
                        styles.td,
                        { width: c.w },
                        c.left ? styles.left : styles.right,
                        isClub && styles.clubCell,
                        c.accent && styles.accentCell,
                        redLat && styles.redCell,
                      ]}>
                      {cellText(row, c.key)}
                    </Text>
                  );
                })}
              </View>
              {idx < d.rows.length - 1 && (
                <View style={[styles.tr, styles.gapRow]}>
                  <View style={{ width: COLS[0].w + COLS[1].w }} />
                  <Text numberOfLines={1} style={[styles.gapText, { width: COLS[2].w }]}>
                    ↕ {row.carry - d.rows[idx + 1].carry} yd
                  </Text>
                </View>
              )}
            </View>
          ))}
        </View>
      </ScrollView>

      <Text style={styles.note}>
        Carry & apex in yards/feet · ball speed mph · launch in degrees. The number between two
        clubs is the carry gap. Tap the Clubs tab for full per-club detail.
      </Text>

      <Link href={'/model' as Href} style={styles.modelLink}>
        About the model →
      </Link>
      </Bounded>
    </ScrollView>
  );
}

const mono = 'monospace';
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  pageContent: { padding: 18, paddingBottom: 40 },
  center: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: C.ink },
  emptyDim: { fontFamily: mono, fontSize: 13, color: C.dim, marginTop: 8, textAlign: 'center', lineHeight: 19 },
  sampleBtn: {
    marginTop: 22,
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 26,
    minWidth: 200,
    alignItems: 'center',
  },
  sampleBtnTxt: { color: '#0a120d', fontWeight: '800', fontSize: 15 },
  seedErr: { fontFamily: mono, fontSize: 12, color: C.bad, marginTop: 12, textAlign: 'center' },
  kicker: { fontFamily: mono, fontSize: 11, letterSpacing: 2, color: C.accent },
  title: { fontSize: 38, fontWeight: '800', color: C.ink, marginTop: 8, letterSpacing: 0.5 },
  titleAccent: { color: C.accent },
  lead: { fontSize: 15, color: C.dim, marginTop: 10, lineHeight: 21 },

  statStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 18,
    marginTop: 22,
    marginBottom: 8,
  },
  stat: { width: '47%' },
  statV: { fontFamily: mono, fontSize: 30, color: C.accent },
  statL: { fontFamily: mono, fontSize: 10, color: C.dim, letterSpacing: 1, marginTop: 3 },

  compareBtn: {
    alignSelf: 'flex-start',
    marginTop: 18,
    fontFamily: mono,
    fontSize: 13,
    color: C.accent2,
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 11,
    overflow: 'hidden',
  },
  tableHead: { marginTop: 22, marginBottom: 8 },
  tableTitle: { fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: 0.5 },
  tableSub: { fontFamily: mono, fontSize: 11, color: C.dim, marginTop: 2 },

  tableWrap: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    backgroundColor: C.bg2,
  },
  tr: { flexDirection: 'row', alignItems: 'center' },
  groupRow: { borderBottomWidth: 1, borderBottomColor: '#142219' },
  headRow: { borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 10 },
  th: {
    fontFamily: mono,
    fontSize: 10,
    letterSpacing: 0.5,
    color: C.dim2,
    textTransform: 'uppercase',
    paddingHorizontal: 10,
  },
  td: { fontFamily: mono, fontSize: 13, color: C.dim, paddingHorizontal: 10, paddingTop: 10 },
  left: { textAlign: 'left' },
  right: { textAlign: 'right' },
  clubCell: { color: C.ink, fontWeight: '700', fontFamily: 'System', fontSize: 14 },
  accentCell: { color: C.accent, fontSize: 15, fontWeight: '600' },
  redCell: { color: C.bad },
  gapRow: { paddingTop: 2, paddingBottom: 8 },
  gapText: { fontFamily: mono, fontSize: 10, color: C.dim2, textAlign: 'right', letterSpacing: 0.5 },

  note: { fontFamily: mono, fontSize: 11, color: C.dim2, marginTop: 16, lineHeight: 18 },
  modelLink: { fontFamily: mono, fontSize: 12, color: C.accent2, marginTop: 18, letterSpacing: 0.5 },
  account: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 26,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  accountEmail: { fontFamily: mono, fontSize: 11, color: C.dim2, flex: 1, marginRight: 10 },
  signOut: { fontFamily: mono, fontSize: 12, color: C.bad },
});

