import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import BackBar from '@/components/BackBar';
import Bounded from '@/components/Bounded';
import { loadBagSummary, type BagSummaryClub } from '@/lib/bagSummary';
import { r1 } from '@/lib/format';
import { C } from '@/theme';

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

function cellText(c: BagSummaryClub, key: string): string {
  switch (key) {
    case 'club':
      return c.club;
    case 'loft':
      return c.loft != null ? `${c.loft}°` : '–';
    case 'carry':
      return String(c.carry);
    case 'total':
      return String(c.total);
    case 'ball':
      return String(c.ballSpeed);
    case 'launch':
      return r1(c.launchAngle) + '°';
    case 'apex':
      return String(c.apex);
    default:
      return '';
  }
}

interface State {
  loading: boolean;
  summary: BagSummaryClub[];
  displayName: string;
  error?: string;
}

export default function ConnectionBag() {
  const params = useLocalSearchParams<{ u?: string | string[]; name?: string | string[] }>();
  const uid = Array.isArray(params.u) ? params.u[0] : params.u;
  const nameParam = (Array.isArray(params.name) ? params.name[0] : params.name) ?? '';
  const [state, setState] = useState<State>({ loading: true, summary: [], displayName: nameParam });

  useEffect(() => {
    let alive = true;
    if (!uid) {
      setState({ loading: false, summary: [], displayName: nameParam, error: 'No connection specified.' });
      return;
    }
    loadBagSummary(uid).then((res) => {
      if (!alive) return;
      setState({
        loading: false,
        summary: res.summary,
        displayName: res.displayName || nameParam,
        error: res.error,
      });
    });
    return () => {
      alive = false;
    };
  }, [uid, nameParam]);

  const disp = useMemo(() => state.summary.slice().reverse(), [state.summary]);
  const title = state.displayName || nameParam || 'Connection';

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <BackBar label="Connections" />
      <Bounded>
      <Text style={styles.kicker}>CONNECTION</Text>
      <Text style={styles.title}>
        {title}
        {"'s "}
        <Text style={styles.accent}>BAG</Text>
      </Text>
      <Text style={styles.lead}>
        Their shared bag summary & average trajectories — raw shots are never shared.
      </Text>

      {state.loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} size="large" />
        </View>
      ) : state.error ? (
        <Text style={styles.msg}>Could not load this bag: {state.error}</Text>
      ) : !disp.length ? (
        <Text style={styles.msg}>
          This connection hasn’t shared any club data yet. Once they upload a session, their bag
          summary will appear here.
        </Text>
      ) : (
        <>
          <View style={styles.tableHead}>
            <Text style={styles.tableTitle}>CLUB SUMMARY</Text>
            <Text style={styles.tableSub}>averages per club · swipe →</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableWrap}>
            <View>
              <View style={[styles.tr, styles.headRow]}>
                {COLS.map((col) => (
                  <Text
                    key={col.key}
                    numberOfLines={1}
                    style={[styles.th, { width: col.w }, col.left ? styles.left : styles.right]}>
                    {col.label}
                  </Text>
                ))}
              </View>
              {disp.map((c, idx) => (
                <View key={c.club} style={styles.groupRow}>
                  <View style={styles.tr}>
                    {COLS.map((col) => (
                      <Text
                        key={col.key}
                        numberOfLines={1}
                        style={[
                          styles.td,
                          { width: col.w },
                          col.left ? styles.left : styles.right,
                          col.key === 'club' && styles.clubCell,
                          col.accent && styles.accentCell,
                        ]}>
                        {cellText(c, col.key)}
                      </Text>
                    ))}
                  </View>
                  {idx < disp.length - 1 && (
                    <View style={[styles.tr, styles.gapRow]}>
                      <View style={{ width: COLS[0].w + COLS[1].w }} />
                      <Text numberOfLines={1} style={[styles.gapText, { width: COLS[2].w }]}>
                        ↕ {c.carry - disp[idx + 1].carry} yd
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
          <Text style={styles.note}>
            Carry & apex in yards/feet · ball speed mph · launch in degrees. Modeled through the same
            physics engine as your own bag.
          </Text>
        </>
      )}
      </Bounded>
    </ScrollView>
  );
}

const mono = 'monospace';
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 18, paddingBottom: 40 },
  center: { paddingVertical: 60, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: mono, fontSize: 11, letterSpacing: 2, color: C.accent2, marginTop: 6 },
  title: { fontSize: 34, fontWeight: '800', color: C.ink, marginTop: 8, letterSpacing: 0.5 },
  accent: { color: C.accent },
  lead: { fontSize: 14, color: C.dim, marginTop: 10, lineHeight: 20 },
  msg: { fontFamily: mono, fontSize: 13, color: C.dim, marginTop: 28, lineHeight: 20 },
  tableHead: { marginTop: 22, marginBottom: 8 },
  tableTitle: { fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: 0.5 },
  tableSub: { fontFamily: mono, fontSize: 11, color: C.dim, marginTop: 2 },
  tableWrap: { borderWidth: 1, borderColor: C.line, borderRadius: 12, backgroundColor: C.bg2 },
  tr: { flexDirection: 'row', alignItems: 'center' },
  groupRow: { borderBottomWidth: 1, borderBottomColor: '#142219' },
  headRow: { borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 10 },
  th: { fontFamily: mono, fontSize: 10, letterSpacing: 0.5, color: C.dim2, textTransform: 'uppercase', paddingHorizontal: 10 },
  td: { fontFamily: mono, fontSize: 13, color: C.dim, paddingHorizontal: 10, paddingTop: 10 },
  left: { textAlign: 'left' },
  right: { textAlign: 'right' },
  clubCell: { color: C.ink, fontWeight: '700', fontFamily: 'System', fontSize: 14 },
  accentCell: { color: C.accent, fontSize: 15, fontWeight: '600' },
  gapRow: { paddingTop: 2, paddingBottom: 8 },
  gapText: { fontFamily: mono, fontSize: 10, color: C.dim2, textAlign: 'right', letterSpacing: 0.5 },
  note: { fontFamily: mono, fontSize: 11, color: C.dim2, marginTop: 16, lineHeight: 18 },
});
