import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useAuth } from '@/lib/auth';
import { CLUB_ORDER, DEFAULT_LOFTS } from '@/lib/clubData';
import { useDataActions, useRawData } from '@/lib/dataStore';
import { fmt } from '@/lib/format';
import { importCsvText, MAX_FILE_BYTES } from '@/lib/csvImport';
import { takePendingShared } from '@/lib/pendingShared';
import { useProfile } from '@/lib/profile';
// @ts-ignore — plain-JS shared module (no type declarations)
import { deviceLabel, parseDeviceFile, numericClubs } from '@/shared/device-adapters.js';
import { orderIdx, type RawShot } from '@/rawData';
import { C } from '@/theme';

const mono = 'monospace';

// ---- column model (mirrors COLS in raw-data.html) ----
type ColType = 'idx' | 'date' | 'club' | 'excl' | 'num';
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
];

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
  const [deleting, setDeleting] = useState(false);
  const { deleteAllData } = useDataActions();
  const { prefs, updatePrefs, loading: profileLoading } = useProfile();
  // One-time "map your wedges" prompt: number-only club codes pending a mapping + the
  // file texts to re-import once mapped.
  const [mapping, setMapping] = useState<{ need: Record<string, string[]>; texts: string[] } | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({}); // "device|code" → club

  const confirmDeleteAll = useCallback(() => {
    Alert.alert(
      'Delete all data',
      'This permanently deletes ALL your shots and sessions. Your account stays. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const { error } = await deleteAllData();
            setDeleting(false);
            if (error) Alert.alert('Could not delete', error);
          },
        },
      ],
    );
  }, [deleteAllData]);

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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter(
      (r) => clubState[r.club] && (r.session ? sessState[r.session] !== false : true),
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
      let x = Number((a as Record<string, unknown>)[sortKey]);
      let y = Number((b as Record<string, unknown>)[sortKey]);
      if (Number.isNaN(x)) x = -Infinity;
      if (Number.isNaN(y)) y = -Infinity;
      return (x - y) * dir;
    });
    return sorted;
  }, [rows, clubState, sessState, query, sortKey, sortDir]);

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
        setUploadMsg(lastErr || 'No valid shot rows found in those files.');
        return;
      }
      await refresh();
      const devs = [...devices].map(deviceLabel).join(', ');
      setUploadMsg('Added ' + added + ' shots' + (devs ? ' (' + devs + ')' : '') + (lastErr ? ' · ' + lastErr : '') + '.');
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
    if (!userId || profileLoading) return;
    const texts = takePendingShared();
    if (!texts || !texts.length) return;
    setBusy(true);
    setUploadMsg('Importing ' + texts.length + ' shared file(s)…');
    runImport(texts, (prefs.clubMap as Record<string, Record<string, string>>) || {}).finally(() => setBusy(false));
  }, [userId, profileLoading, prefs, runImport]);

  if (loading) {
    return (
      <View style={[styles.page, styles.center]}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <BackBar label="Settings" />
      <Bounded>
      <Text style={styles.kicker}>GARMIN APPROACH R50</Text>
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

      {/* club filter chips */}
      <View style={styles.chipWrap}>
        {clubKeys.map((club) => {
          const on = clubState[club];
          const col = colors[club] || C.dim;
          return (
            <Pressable
              key={club}
              onPress={() => setClubState((s) => ({ ...s, [club]: !s[club] }))}
              style={[
                styles.chip,
                on
                  ? { backgroundColor: col, borderColor: col }
                  : { backgroundColor: C.bg2, borderColor: C.line2 },
              ]}>
              <Text style={[styles.chipTxt, on ? styles.chipTxtOn : styles.chipTxtOff]}>
                {club}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* sessions + upload */}
      <Text style={[styles.lbl, styles.sessLbl]}>SESSIONS</Text>
      <View style={styles.chipWrap}>
        {sessions.map((s) => {
          const on = sessState[s.id] !== false;
          const n = sessionCounts[s.id] || 0;
          return (
            <Pressable
              key={s.id}
              onPress={() => setSessState((st) => ({ ...st, [s.id]: st[s.id] === false }))}
              style={[
                styles.chip,
                on
                  ? { backgroundColor: C.accent2, borderColor: C.accent2 }
                  : { backgroundColor: C.bg2, borderColor: C.line2 },
              ]}>
              <Text style={[styles.chipTxt, on ? styles.chipTxtOn : styles.chipTxtOff]}>
                {s.label}
                {s._uploaded ? ' •' : ''} ({n})
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={onUpload}
          disabled={busy}
          style={[styles.chip, styles.uploadChip, busy && styles.uploadBusy]}>
          <Text style={styles.uploadTxt}>{busy ? '… working' : '+ Upload session CSV'}</Text>
        </Pressable>
      </View>
      {uploadMsg ? <Text style={styles.uploadMsg}>{uploadMsg}</Text> : null}

      {totalCount > 0 ? (
        <Pressable
          onPress={confirmDeleteAll}
          disabled={deleting}
          style={[styles.deleteAllBtn, deleting && styles.uploadBusy]}>
          <Text style={styles.deleteAllTxt}>{deleting ? '… deleting' : 'Delete all data'}</Text>
        </Pressable>
      ) : null}

      {/* table */}
      <View style={styles.tableWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            {/* header */}
            <View style={[styles.tr, styles.headRow]}>
              {COLS.map((c) => {
                const sorted = c.key === sortKey;
                const left = c.type === 'idx' || c.type === 'date' || c.type === 'club';
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

            {/* body */}
            {shots.length === 0 ? (
              <View style={styles.emptyRow}>
                <Text style={styles.emptyTitle}>No shots yet</Text>
                <Text style={styles.emptyHint}>Upload a session CSV above, or load sample data from the Bag tab.</Text>
              </View>
            ) : shown.length === 0 ? (
              <View style={styles.emptyRow}>
                <Text style={styles.empty}>No shots match.</Text>
              </View>
            ) : (
              shown.map((r) => (
                <View key={r._idx} style={[styles.tr, styles.bodyRow]}>
                  {COLS.map((c) => {
                    const ex = !!r.excluded;
                    const dim = ex && c.type !== 'excl';
                    if (c.type === 'idx') {
                      return (
                        <Text
                          key={c.key}
                          style={[styles.td, styles.idxCell, { width: c.w }, dim && styles.exDim]}>
                          {r._idx}
                        </Text>
                      );
                    }
                    if (c.type === 'date') {
                      return (
                        <Text
                          key={c.key}
                          numberOfLines={1}
                          style={[
                            styles.td,
                            styles.alLeft,
                            styles.dateCell,
                            { width: c.w },
                            dim && styles.exDim,
                          ]}>
                          {r.session_label || r.date || '—'}
                        </Text>
                      );
                    }
                    if (c.type === 'club') {
                      return (
                        <View
                          key={c.key}
                          style={[styles.clubCellWrap, { width: c.w }, dim && styles.exDim]}>
                          <View style={[styles.sw, { backgroundColor: r._color }]} />
                          <Text numberOfLines={1} style={styles.clubTxt}>
                            {r.club}
                          </Text>
                        </View>
                      );
                    }
                    if (c.type === 'excl') {
                      return (
                        <View key={c.key} style={[styles.exCellWrap, { width: c.w }]}>
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
                    // numeric
                    const raw = (r as Record<string, unknown>)[c.key];
                    const n = Number(raw);
                    const neg = c.signed && !Number.isNaN(n) && n < 0;
                    return (
                      <Text
                        key={c.key}
                        style={[
                          styles.td,
                          styles.alRight,
                          { width: c.w },
                          neg && styles.neg,
                          dim && styles.exDim,
                        ]}>
                        {numText(raw, c)}
                      </Text>
                    );
                  })}
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </View>

      <Text style={styles.foot}>
        ABSHERMETRICS · raw launch-monitor export · Garmin Approach R50 · {fmt(totalCount, 0)} shots
      </Text>
      </Bounded>

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
    </ScrollView>
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
});
