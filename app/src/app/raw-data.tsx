import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  type ListRenderItemInfo,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import BackBar from '@/components/BackBar';
import Bounded from '@/components/Bounded';
import { FilterMenu } from '@/components/FilterMenu';
import { useAuth } from '@/lib/auth';
import { CLUB_ORDER, DEFAULT_LOFTS } from '@/lib/clubData';
import { useDataActions, useRawData } from '@/lib/dataStore';
import { importCsvText, MAX_FILE_BYTES } from '@/lib/csvImport';
import { subscribePendingShared, takePendingShared } from '@/lib/pendingShared';
import { useProfile } from '@/lib/profile';
import { useView } from '@/lib/viewContext';
// @ts-ignore — plain-JS shared module (no type declarations)
import { deviceLabel, parseDeviceFile, numericClubs } from '@/shared/device-adapters.js';
import { orderIdx, type RawShot } from '@/rawData';
import { C } from '@/theme';

const mono = 'monospace';

// ---- column model (mirrors COLS in raw-data.html) ----
type ColType = 'idx' | 'date' | 'club' | 'device' | 'excl' | 'num' | 'del';
interface Col {
  key: string;
  label: string;
  unit: string;
  type: ColType;
  dp?: number;
  signed?: boolean;
  w: number;
}
const COLS: Col[] = [
  { key: '_idx', label: '#', unit: '', type: 'idx', w: 46 },
  { key: 'date', label: 'Date', unit: '', type: 'date', w: 150 },
  { key: 'club', label: 'Club', unit: '', type: 'club', w: 124 },
  { key: 'device', label: 'Device', unit: '', type: 'device', w: 96 },
  { key: 'excluded', label: 'In Model', unit: '', type: 'excl', w: 84 },
  { key: 'bs', label: 'Ball Spd', unit: 'mph', type: 'num', dp: 1, w: 84 },
  { key: 'carry', label: 'Carry', unit: 'yd', type: 'num', dp: 1, w: 74 },
  { key: 'total', label: 'Total', unit: 'yd', type: 'num', dp: 1, w: 74 },
  { key: 'la', label: 'Launch', unit: '°', type: 'num', dp: 1, w: 74 },
  { key: 'ld', label: 'Launch Dir', unit: '°', type: 'num', dp: 1, signed: true, w: 92 },
  { key: 'spin', label: 'Spin', unit: 'rpm', type: 'num', dp: 0, w: 80 },
  { key: 'bspin', label: 'Backspin', unit: 'rpm', type: 'num', dp: 0, w: 88 },
  { key: 'sspin', label: 'Sidespin', unit: 'rpm', type: 'num', dp: 0, signed: true, w: 88 },
  { key: 'axis', label: 'Spin Axis', unit: '°', type: 'num', dp: 1, signed: true, w: 88 },
  { key: 'apex', label: 'Apex', unit: 'ft', type: 'num', dp: 1, w: 74 },
  { key: 'dev', label: 'Lateral', unit: 'yd', type: 'num', dp: 1, signed: true, w: 78 },
  { key: '_del', label: '', unit: '', type: 'del', w: 52 },
];

// Total table width = sum of column widths. The horizontal ScrollView scrolls this; the
// header row and every body row are exactly this wide so they align + scroll together.
const TOTAL_W = COLS.reduce((s, c) => s + c.w, 0);

// Each table row = a RawShot tagged with display index + resolved color.
interface Row extends RawShot {
  _idx: number;
  _color: string;
}


// ---- cell rendering ----
function numText(v: unknown, c: Col): string {
  if (v === undefined || v === null || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  let s = n.toFixed(c.dp ?? 1);
  if (c.dp === 0) s = Number(s).toLocaleString('en-US');
  if (c.signed && n > 0) s = '+' + s;
  return s;
}

// Per-column width style objects, precomputed once so cells don't allocate a fresh
// { width } object on every render.
const COL_W: Record<string, { width: number }> = {};
COLS.forEach((c) => {
  COL_W[c.key] = { width: c.w };
});

// One table row, MEMOIZED. A filter/sort/search/typing change re-runs the parent, but a
// row whose `row` reference is unchanged (every surviving row after a chip toggle) skips
// re-render entirely — turning a "re-render hundreds of rows" toggle into "touch only the
// rows that actually changed". `isViewingOther` + `onDelete` are stable references.
const TableRow = memo(function TableRow({
  row,
  isViewingOther,
  onDelete,
}: {
  row: Row;
  isViewingOther: boolean;
  onDelete: (r: Row) => void;
}) {
  const ex = !!row.excluded;
  return (
    <View style={styles.bodyTr}>
      {COLS.map((c) => {
        const dim = ex && c.type !== 'excl';
        const w = COL_W[c.key];
        if (c.type === 'idx') {
          return (
            <Text key={c.key} style={[styles.td, styles.idxCell, w, dim && styles.exDim]}>
              {row._idx}
            </Text>
          );
        }
        if (c.type === 'date') {
          return (
            <Text
              key={c.key}
              numberOfLines={1}
              style={[styles.td, styles.alLeft, styles.dateCell, w, dim && styles.exDim]}>
              {row.session_label || row.date || '—'}
            </Text>
          );
        }
        if (c.type === 'club') {
          return (
            <View key={c.key} style={[styles.clubCellWrap, w, dim && styles.exDim]}>
              <View style={[styles.sw, { backgroundColor: row._color }]} />
              <Text numberOfLines={1} style={styles.clubTxt}>
                {row.club}
              </Text>
            </View>
          );
        }
        if (c.type === 'device') {
          return (
            <View key={c.key} style={[styles.deviceCellWrap, w, dim && styles.exDim]}>
              <Text numberOfLines={1} style={styles.deviceBadge}>
                {deviceLabel((row.device as string) || 'garmin_r50')}
              </Text>
            </View>
          );
        }
        if (c.type === 'excl') {
          return (
            <View key={c.key} style={[styles.exCellWrap, w]}>
              {ex ? (
                <View style={styles.exBadge}>
                  <Text style={styles.exBadgeTxt}>Excluded</Text>
                </View>
              ) : (
                <Text style={styles.inBadge}>✓</Text>
              )}
            </View>
          );
        }
        if (c.type === 'del') {
          return (
            <View key={c.key} style={[styles.delCellWrap, w]}>
              {isViewingOther ? null : (
                <Pressable onPress={() => onDelete(row)} hitSlop={8} style={styles.delBtn}>
                  <Text style={styles.delTxt}>✕</Text>
                </Pressable>
              )}
            </View>
          );
        }
        const raw = (row as Record<string, unknown>)[c.key];
        const n = Number(raw);
        const neg = c.signed && !Number.isNaN(n) && n < 0;
        return (
          <Text key={c.key} style={[styles.td, styles.alRight, w, neg && styles.neg, dim && styles.exDim]}>
            {numText(raw, c)}
          </Text>
        );
      })}
    </View>
  );
});

export default function RawData() {
  const { shots, sessions, colors, loading, refresh } = useRawData();
  const { session: authSession } = useAuth();
  const userId = authSession?.user?.id;

  const [clubState, setClubState] = useState<Record<string, boolean>>({});
  const [sessState, setSessState] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<string>('_idx');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [query, setQuery] = useState('');
  const [uploadMsg, setUploadMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // Measured height of the table area → gives the FlatList a bounded viewport so it
  // virtualizes (only on-screen rows exist in the native tree).
  const [tableH, setTableH] = useState(0);
  const { deleteShot } = useDataActions();
  const { isViewingOther } = useView();
  const { prefs, updatePrefs, loading: profileLoading } = useProfile();

  const confirmDeleteShot = useCallback(
    (row: Row) => {
      Alert.alert('Delete shot', `Permanently delete this ${row.club} shot? This can’t be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { if (row.id) void deleteShot(row.id); } },
      ]);
    },
    [deleteShot],
  );
  // Stable renderItem / keyExtractor for the virtualized table body.
  const renderRow = useCallback(
    ({ item }: ListRenderItemInfo<Row>) => (
      <TableRow row={item} isViewingOther={isViewingOther} onDelete={confirmDeleteShot} />
    ),
    [isViewingOther, confirmDeleteShot],
  );
  const keyExtractor = useCallback((r: Row) => String(r.id ?? r._idx), []);
  // One-time "map your wedges" prompt: number-only club codes pending a mapping + the
  // file texts to re-import once mapped.
  const [mapping, setMapping] = useState<{ need: Record<string, string[]>; texts: string[] } | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({}); // "device|code" → club

  // Table rows = each RawShot tagged with display index + resolved color.
  const rows = useMemo<Row[]>(
    () =>
      shots.map((s, i) => ({
        ...s,
        _idx: i + 1,
        _color: colors[s.club] || C.dim,
      })),
    [shots, colors],
  );

  // Keep new clubs/sessions visible by default as data arrives.
  useEffect(() => {
    setClubState((prev) => {
      const cs = { ...prev };
      let changed = false;
      rows.forEach((r) => {
        if (!(r.club in cs)) {
          cs[r.club] = true;
          changed = true;
        }
      });
      return changed ? cs : prev;
    });
  }, [rows]);

  useEffect(() => {
    setSessState((prev) => {
      const ss = { ...prev };
      let changed = false;
      sessions.forEach((s) => {
        if (!(s.id in ss)) {
          ss[s.id] = true;
          changed = true;
        }
      });
      return changed ? ss : prev;
    });
  }, [sessions]);

  const setSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d * -1) as 1 | -1);
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  const clubKeys = useMemo(
    () => Object.keys(clubState).sort((a, b) => orderIdx(a) - orderIdx(b)),
    [clubState],
  );

  const sessionCounts = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach((r) => {
      if (r.session) m[r.session] = (m[r.session] || 0) + 1;
    });
    return m;
  }, [rows]);

  const totalCount = rows.length;
  const exclCount = useMemo(() => rows.filter((r) => r.excluded).length, [rows]);
  // Distinct launch monitors present in the data — drives the kicker/footer label
  // and matches the per-row Device badge (legacy rows with no device read as R50).
  const deviceLabels = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add((r.device as string) || 'garmin_r50'));
    return [...set].map((d) => deviceLabel(d));
  }, [rows]);
  const deviceLine = deviceLabels.length ? deviceLabels.join(' · ') : 'Garmin R50';

  // Compact club + session filters (same menu pattern as the 2D/3D club picker) so long
  // filter lists collapse to one line each instead of filling the screen with chips.
  const clubItems = useMemo(
    () => clubKeys.map((c) => ({ key: c, label: c, color: colors[c] || C.dim })),
    [clubKeys, colors],
  );
  const sessionItems = useMemo(
    () =>
      sessions.map((s) => ({
        key: s.id,
        label: `${s.label}${s._uploaded ? ' •' : ''} (${sessionCounts[s.id] || 0})`,
        color: C.accent2,
      })),
    [sessions, sessionCounts],
  );
  const toggleClub = useCallback((c: string) => setClubState((s) => ({ ...s, [c]: !s[c] })), []);
  const setAllClubs = useCallback(
    (on: boolean) =>
      setClubState((s) => {
        const n = { ...s };
        clubKeys.forEach((c) => (n[c] = on));
        return n;
      }),
    [clubKeys],
  );
  const toggleSession = useCallback(
    (id: string) => setSessState((st) => ({ ...st, [id]: st[id] === false })),
    [],
  );
  const setAllSessions = useCallback(
    (on: boolean) =>
      setSessState((st) => {
        const n = { ...st };
        sessions.forEach((s) => (n[s.id] = on));
        return n;
      }),
    [sessions],
  );

  // Defer the table's filter inputs so a chip tap / keystroke updates the chip (urgent)
  // immediately while the heavier table recompute + re-render runs as a NON-BLOCKING
  // transition — the tap feels instant instead of waiting ~1s for the rows to update.
  const deferredQuery = useDeferredValue(query);
  const deferredClubState = useDeferredValue(clubState);
  const deferredSessState = useDeferredValue(sessState);

  const shown = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let out = rows.filter(
      (r) => deferredClubState[r.club] && (r.session ? deferredSessState[r.session] !== false : true),
    );
    if (q) {
      out = out.filter(
        (r) =>
          COLS.some((c) => {
            const v = (r as Record<string, unknown>)[c.key];
            return v !== undefined && String(v).toLowerCase().includes(q);
          }) ||
          r.club.toLowerCase().includes(q) ||
          (r.session_label || '').toLowerCase().includes(q),
      );
    }
    const dir = sortDir;
    const sorted = [...out].sort((a, b) => {
      if (sortKey === 'club') {
        const d = (orderIdx(a.club) - orderIdx(b.club)) * dir;
        return d || (a.ts || '').localeCompare(b.ts || '');
      }
      if (sortKey === 'date') {
        return (a.ts || '').localeCompare(b.ts || '') * dir;
      }
      if (sortKey === 'excluded') {
        const d = ((a.excluded ? 1 : 0) - (b.excluded ? 1 : 0)) * dir;
        return d || (a.ts || '').localeCompare(b.ts || '');
      }
      if (sortKey === 'device') {
        const d =
          ((a.device as string) || 'garmin_r50').localeCompare((b.device as string) || 'garmin_r50') *
          dir;
        return d || (a.ts || '').localeCompare(b.ts || '');
      }
      let x = Number((a as Record<string, unknown>)[sortKey]);
      let y = Number((b as Record<string, unknown>)[sortKey]);
      if (Number.isNaN(x)) x = -Infinity;
      if (Number.isNaN(y)) y = -Infinity;
      return (x - y) * dir;
    });
    return sorted;
  }, [rows, deferredClubState, deferredSessState, deferredQuery, sortKey, sortDir]);

  // Import already-read file texts with the given club mappings. PRE-SCANS for number-
  // only wedges still needing a mapping (no inserts yet) — if any, opens the one-time
  // prompt and returns (so re-importing after mapping can't double-insert). Else inserts.
  const runImport = useCallback(
    async (texts: string[], maps: Record<string, Record<string, string>>) => {
      const need: Record<string, Set<string>> = {};
      for (const txt of texts) {
        try {
          const { device, shots } = parseDeviceFile(txt, { clubMaps: maps });
          for (const code of numericClubs(shots) as string[]) {
            (need[device] || (need[device] = new Set())).add(code);
          }
        } catch {
          /* unrecognized file — importCsvText reports it in the insert pass below */
        }
      }
      if (Object.keys(need).length) {
        const need2: Record<string, string[]> = {};
        const initPicks: Record<string, string> = {};
        for (const d of Object.keys(need)) {
          need2[d] = [...need[d]];
          for (const code of need2[d]) {
            initPicks[d + '|' + code] = CLUB_ORDER.find((c) => DEFAULT_LOFTS[c] === Number(code)) || 'Gap Wedge';
          }
        }
        setPicks(initPicks);
        setMapping({ need: need2, texts });
        setUploadMsg('Map your wedges to continue…');
        return;
      }
      let added = 0;
      let sessions = 0;
      let lastErr: string | undefined;
      const devices = new Set<string>();
      for (const txt of texts) {
        const r = await importCsvText(txt, userId as string, maps);
        if (r.error) lastErr = r.error;
        else {
          added += r.added;
          sessions += 1;
          if (r.device) devices.add(r.device);
        }
      }
      if (sessions === 0) {
        const failMsg = lastErr || 'No valid shot rows found in that file.';
        setUploadMsg(failMsg);
        Alert.alert('Import failed', failMsg);
        return;
      }
      await refresh();
      const devs = [...devices].map(deviceLabel).join(', ');
      setUploadMsg('Added ' + added + ' shots' + (devs ? ' (' + devs + ')' : '') + (lastErr ? ' · ' + lastErr : '') + '.');
      Alert.alert(
        'Import complete',
        'Added ' + added + ' shot' + (added === 1 ? '' : 's') + (devs ? ' from ' + devs : '') + '.' +
          (lastErr ? '\n\nNote: ' + lastErr : ''),
      );
    },
    [userId, refresh],
  );

  const onUpload = useCallback(async () => {
    try {
      setBusy(true);
      if (!userId) {
        setUploadMsg('You must be signed in to upload.');
        return;
      }
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/csv', '*/*'],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets || !res.assets.length) return;
      setUploadMsg('Importing ' + res.assets.length + ' file(s)…');
      const texts: string[] = [];
      let skipErr: string | undefined;
      for (const asset of res.assets) {
        if (asset.size && asset.size > MAX_FILE_BYTES) {
          skipErr = 'Skipped "' + (asset.name ?? 'file') + '": larger than 10 MB.';
          continue;
        }
        texts.push(asset.base64 ? decodeBase64Utf8(asset.base64) : await new File(asset.uri).text());
      }
      if (!texts.length) {
        setUploadMsg(skipErr || 'No files to import.');
        return;
      }
      await runImport(texts, (prefs.clubMap as Record<string, Record<string, string>>) || {});
    } catch (err) {
      setUploadMsg('Could not import (' + (err as Error).message + ').');
    } finally {
      setBusy(false);
    }
  }, [userId, prefs, runImport]);

  // Save the chosen wedge mappings to the profile (cross-device, asked once), then import.
  const saveMapping = useCallback(async () => {
    if (!mapping) return;
    setBusy(true);
    try {
      const maps: Record<string, Record<string, string>> = JSON.parse(JSON.stringify(prefs.clubMap || {}));
      for (const [k, club] of Object.entries(picks)) {
        const i = k.indexOf('|');
        const device = k.slice(0, i);
        const code = k.slice(i + 1);
        (maps[device] || (maps[device] = {}))[code] = club;
      }
      await updatePrefs({ clubMap: maps });
      const texts = mapping.texts;
      setMapping(null);
      await runImport(texts, maps);
    } finally {
      setBusy(false);
    }
  }, [mapping, picks, prefs, updatePrefs, runImport]);

  // Files handed off from the OS "share to AbsherMetrics" flow (see ShareImporter) —
  // import them through the same path (incl. the wedge-mapping prompt). Waits until the
  // profile (and its saved club mappings) has loaded so already-mapped wedges don't
  // re-prompt; takePendingShared() consumes the hand-off exactly once.
  useEffect(() => {
    const tryConsume = () => {
      if (!userId || profileLoading) return;
      const texts = takePendingShared();
      if (!texts || !texts.length) return;
      setBusy(true);
      setUploadMsg('Importing ' + texts.length + ' shared file(s)…');
      runImport(texts, (prefs.clubMap as Record<string, Record<string, string>>) || {})
        .catch((e) => Alert.alert('Import error', e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(false));
    };
    tryConsume(); // a share that arrived before this screen mounted
    return subscribePendingShared(tryConsume); // …or one that arrives while it's already open
  }, [userId, profileLoading, prefs, runImport]);

  if (loading) {
    return (
      <View style={[styles.page, styles.center]}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <BackBar label="Settings" />
      <ScrollView
        style={styles.controlsScroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
      <Bounded>
      <Text style={styles.kicker}>{deviceLine.toUpperCase()}</Text>
      <Text style={styles.title}>
        Raw <Text style={styles.titleAccent}>Shot Data</Text>
      </Text>
      <Text style={styles.lead}>
        Every individual shot exactly as measured by the launch monitor — no smoothing, no
        modeling. Tap any column header to sort; filter by club or session. Shots marked{' '}
        <Text style={styles.exInline}>Excluded</Text> were dropped during cleaning
        (mishits/outliers) and don&apos;t feed the charts, averages, or 3D flight.
      </Text>

      {/* search + count */}
      <View style={styles.row}>
        <Text style={styles.lbl}>SEARCH</Text>
        <TextInput
          style={styles.search}
          placeholder="filter rows…"
          placeholderTextColor={C.dim2}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.countPill}>
          <Text style={styles.countNum}>{shown.length}</Text> of {totalCount} shots
          {exclCount ? <Text style={styles.countDim}> · {exclCount} excluded</Text> : null}
        </Text>
      </View>

      {/* compact club + session filters (same menu pattern as the 2D/3D screens) */}
      <View style={styles.filterRow}>
        <FilterMenu
          label="CLUBS"
          title="Clubs"
          noun="clubs"
          items={clubItems}
          isOn={(k) => !!clubState[k]}
          onToggle={toggleClub}
          onSetAll={setAllClubs}
        />
        <FilterMenu
          label="SESSIONS"
          title="Sessions"
          noun="sessions"
          items={sessionItems}
          isOn={(k) => sessState[k] !== false}
          onToggle={toggleSession}
          onSetAll={setAllSessions}
        />
      </View>

      <Pressable
        onPress={onUpload}
        disabled={busy}
        style={[styles.chip, styles.uploadChip, styles.uploadStandalone, busy && styles.uploadBusy]}>
        <Text style={styles.uploadTxt}>{busy ? '… working' : '+ Upload session CSV'}</Text>
      </Pressable>
      {uploadMsg ? <Text style={styles.uploadMsg}>{uploadMsg}</Text> : null}
      </Bounded>
      </ScrollView>

      {/* Virtualized table — its OWN scroll area below the controls. Giving the FlatList a
          measured, bounded height is what lets it virtualize: only the on-screen rows ever
          exist in the native view tree, so filter/sort/scroll stay fast at any shot count. */}
      <View style={styles.tableArea} onLayout={(e) => setTableH(e.nativeEvent.layout.height)}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={{ width: TOTAL_W, height: tableH }}>
            {/* header */}
            <View style={[styles.tr, styles.headRow]}>
              {COLS.map((c) => {
                if (c.type === 'del') {
                  return <View key={c.key} style={[styles.thCell, { width: c.w }]} />;
                }
                const sorted = c.key === sortKey;
                const left =
                  c.type === 'idx' || c.type === 'date' || c.type === 'club' || c.type === 'device';
                const center = c.type === 'excl';
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => setSort(c.key)}
                    style={[styles.thCell, { width: c.w }]}>
                    <Text
                      style={[
                        styles.th,
                        left ? styles.alLeft : center ? styles.alCenter : styles.alRight,
                        sorted && styles.thSorted,
                      ]}>
                      {c.label}
                      {c.unit ? <Text style={styles.unit}> {c.unit}</Text> : null}
                      {sorted ? (
                        <Text style={styles.arrow}>{sortDir > 0 ? ' ▴' : ' ▾'}</Text>
                      ) : null}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* virtualized body */}
            <View style={styles.tableBody}>
              {shots.length === 0 ? (
                <View style={styles.emptyRow}>
                  <Text style={styles.emptyTitle}>No shots yet</Text>
                  <Text style={styles.emptyHint}>
                    Upload a session CSV above, or load sample data from the Bag tab.
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={shown}
                  renderItem={renderRow}
                  keyExtractor={keyExtractor}
                  style={styles.flatList}
                  initialNumToRender={20}
                  maxToRenderPerBatch={20}
                  windowSize={11}
                  removeClippedSubviews={false}
                  keyboardShouldPersistTaps="handled"
                  ListEmptyComponent={
                    <View style={styles.emptyRow}>
                      <Text style={styles.empty}>No shots match.</Text>
                    </View>
                  }
                />
              )}
            </View>
          </View>
        </ScrollView>
      </View>

      {/* One-time "map your wedges" prompt for number-only club codes (e.g. GC3 "52"). */}
      <Modal visible={!!mapping} transparent animationType="fade" onRequestClose={() => setMapping(null)}>
        <View style={styles.mapOverlay}>
          <View style={styles.mapCard}>
            <Text style={styles.mapTitle}>Map your wedges</Text>
            <Text style={styles.mapSub}>
              Your launch monitor labels some wedges by loft. Match each to a club — asked
              once, then saved for every future upload.
            </Text>
            {mapping
              ? Object.entries(mapping.need).flatMap(([device, codes]) =>
                  codes.map((code) => {
                    const k = device + '|' + code;
                    return (
                      <View key={k} style={styles.mapRow}>
                        <Text style={styles.mapCode}>
                          {deviceLabel(device)} <Text style={{ color: C.accent }}>{code}°</Text>
                        </Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mapChips}>
                          {CLUB_ORDER.map((club) => (
                            <Pressable
                              key={club}
                              onPress={() => setPicks((p) => ({ ...p, [k]: club }))}
                              style={[styles.mapChip, picks[k] === club && styles.mapChipOn]}>
                              <Text style={[styles.mapChipTxt, picks[k] === club && styles.mapChipTxtOn]}>
                                {club}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                    );
                  }),
                )
              : null}
            <Pressable onPress={saveMapping} disabled={busy} style={[styles.mapSaveBtn, busy && { opacity: 0.6 }]}>
              {busy ? <ActivityIndicator color="#0a120d" /> : <Text style={styles.mapSaveTxt}>Save &amp; import</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Decode a base64 string to a UTF-8 JS string (web picker returns base64).
function decodeBase64Utf8(b64: string): string {
  // strip a possible data: URL prefix
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const g = globalThis as unknown as { atob?: (s: string) => string };
  if (typeof g.atob === 'function') {
    const bin = g.atob(clean);
    try {
      const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return bin;
    }
  }
  return clean;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48 },
  center: { alignItems: 'center', justifyContent: 'center' },

  kicker: { fontFamily: mono, fontSize: 11, letterSpacing: 3, color: C.accent },
  title: { fontSize: 38, fontWeight: '800', color: C.ink, marginTop: 6, letterSpacing: 0.5 },
  titleAccent: { color: C.accent },
  lead: { fontSize: 14, color: C.dim, marginTop: 10, lineHeight: 20 },
  exInline: {
    color: C.bad,
    fontFamily: mono,
    fontSize: 12,
  },

  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  lbl: { fontFamily: mono, fontSize: 10, letterSpacing: 1, color: C.dim2 },
  sessLbl: { marginTop: 16, marginBottom: 6 },
  search: {
    fontFamily: mono,
    fontSize: 12,
    color: C.ink,
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 150,
    flexGrow: 1,
  },
  countPill: { fontFamily: mono, fontSize: 11, color: C.dim, flexBasis: '100%', marginTop: 2 },
  countNum: { color: C.accent },
  countDim: { color: C.dim2 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 18 },
  uploadStandalone: { alignSelf: 'flex-start', marginTop: 14 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 11, paddingVertical: 6 },
  chipTxt: { fontFamily: mono, fontSize: 11 },
  chipTxtOn: { color: '#0a120d', fontWeight: '600' },
  chipTxtOff: { color: C.dim },
  uploadChip: { borderStyle: 'dashed', borderColor: C.accent2, backgroundColor: C.bg2 },
  uploadBusy: { opacity: 0.6 },
  uploadTxt: { fontFamily: mono, fontSize: 11, color: C.accent2 },
  deleteAllBtn: {
    alignSelf: 'flex-start',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#5e2b2b',
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  deleteAllTxt: { fontFamily: mono, fontSize: 12, color: C.bad, fontWeight: '700' },
  uploadMsg: { fontFamily: mono, fontSize: 11, color: C.dim, marginTop: 8, minHeight: 14 },

  tableWrap: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    backgroundColor: C.bg2,
    marginTop: 16,
    overflow: 'hidden',
  },
  // Controls (title/chips/etc.) scroll independently and take only the space they need,
  // leaving the rest of the screen to the virtualized table below.
  controlsScroll: { flexGrow: 0, flexShrink: 1 },
  // The table fills the remaining height; its measured height bounds the FlatList. minHeight
  // guarantees it never collapses to nothing when the controls are tall (many sessions).
  tableArea: {
    flex: 1,
    minHeight: 220,
    backgroundColor: C.bg2,
    borderTopWidth: 1,
    borderTopColor: C.line2,
  },
  tableBody: { flex: 1 },
  flatList: { flex: 1 },
  tr: { flexDirection: 'row', alignItems: 'center' },
  headRow: {
    backgroundColor: '#0c1712',
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
    paddingVertical: 9,
  },
  thCell: { paddingHorizontal: 10, justifyContent: 'center' },
  th: {
    fontFamily: mono,
    fontSize: 9.5,
    letterSpacing: 0.5,
    color: C.dim2,
    textTransform: 'uppercase',
  },
  thSorted: { color: C.accent },
  unit: { color: C.dim2, fontSize: 8.5, textTransform: 'none', letterSpacing: 0 },
  arrow: { color: C.accent, fontSize: 9 },

  bodyRow: { borderBottomWidth: 1, borderBottomColor: '#142219' },
  // Merged tr + bodyRow so each memoized row uses a single stable style reference.
  bodyTr: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#142219',
  },
  td: {
    fontFamily: mono,
    fontSize: 13,
    color: C.ink,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  alLeft: { textAlign: 'left' },
  alRight: { textAlign: 'right' },
  alCenter: { textAlign: 'center' },
  idxCell: { color: C.dim2, fontSize: 11, textAlign: 'left' },
  dateCell: { color: C.dim, fontSize: 12 },
  neg: { color: C.bad },
  exDim: { opacity: 0.42 },

  clubCellWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  sw: { width: 9, height: 9, borderRadius: 5, marginRight: 7 },
  clubTxt: { fontSize: 14, color: C.ink, fontWeight: '600', flexShrink: 1 },

  deviceCellWrap: { paddingHorizontal: 10, paddingVertical: 9, justifyContent: 'center' },
  deviceBadge: {
    fontFamily: mono,
    fontSize: 10,
    color: C.dim,
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },

  exCellWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 9 },
  exBadge: {
    borderWidth: 1,
    borderColor: '#5e2b2b',
    backgroundColor: '#2a1414',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  exBadgeTxt: {
    fontFamily: mono,
    fontSize: 9.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: C.bad,
  },
  inBadge: { color: C.dim2, fontSize: 13 },

  emptyRow: { paddingVertical: 40, paddingHorizontal: 20, alignItems: 'center', minWidth: 760 },
  empty: { fontFamily: mono, fontSize: 13, color: C.dim },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.ink },
  emptyHint: { fontFamily: mono, fontSize: 12, color: C.dim, marginTop: 8 },

  foot: {
    fontFamily: mono,
    fontSize: 11,
    color: C.dim2,
    marginTop: 22,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  // ---- "map your wedges" modal ----
  mapOverlay: { flex: 1, backgroundColor: '#070d0af2', alignItems: 'center', justifyContent: 'center', padding: 22 },
  mapCard: { width: '100%', maxWidth: 460, borderWidth: 1, borderColor: C.line2, borderRadius: 14, backgroundColor: C.panel, padding: 20 },
  mapTitle: { color: C.ink, fontSize: 20, fontWeight: '800', marginBottom: 6 },
  mapSub: { color: C.dim, fontFamily: mono, fontSize: 12, lineHeight: 18, marginBottom: 8 },
  mapRow: { marginTop: 12 },
  mapCode: { color: C.dim, fontFamily: mono, fontSize: 13, marginBottom: 6 },
  mapChips: { flexGrow: 0 },
  mapChip: { borderWidth: 1, borderColor: C.line2, backgroundColor: C.bg2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, marginRight: 7 },
  mapChipOn: { borderColor: C.accent, backgroundColor: C.accent },
  mapChipTxt: { color: C.dim, fontSize: 13 },
  mapChipTxtOn: { color: '#0a120d', fontWeight: '700' },
  mapSaveBtn: { backgroundColor: C.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 20 },
  mapSaveTxt: { color: '#0a120d', fontWeight: '800', fontSize: 16 },
  // ---- per-shot delete ----
  delCellWrap: { alignItems: 'center', justifyContent: 'center' },
  delBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#5e2b2b' },
  delTxt: { color: C.bad, fontSize: 13, fontWeight: '700' },
});
