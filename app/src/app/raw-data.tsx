import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { fmt } from '@/lib/format';
import {
  getRawData,
  loadUploaded,
  orderIdx,
  saveUploaded,
  type RawData,
  type RawShot,
  type Session,
} from '@/rawData';
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

// ---- CSV parsing (mirrors FIELD_MAP / parseCSV / sessionFromFile) ----
const FIELD_MAP: Record<string, string> = {
  'Ball Speed': 'bs',
  'Launch Angle': 'la',
  'Launch Direction': 'ld',
  Backspin: 'bspin',
  Sidespin: 'sspin',
  'Spin Rate': 'spin',
  'Spin Axis': 'axis',
  'Apex Height': 'apex',
  'Carry Distance': 'carry',
  'Total Distance': 'total',
  'Carry Deviation Distance': 'dev',
  'Club Speed': 'cs',
  'Smash Factor': 'smash',
};

// Intermediate parsed shot, carrying a JS Date until sessionFromFile resolves it.
type ParsedShot = RawShot & { _ts?: Date };

function parseCSV(text: string): ParsedShot[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim());
  // detect & skip a units row (second row where Date cell is empty)
  let start = 1;
  const secondCells = lines[1].split(',');
  if (!secondCells[0].trim()) start = 2;
  const out: ParsedShot[] = [];
  for (let i = start; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const row: Record<string, string> = {};
    head.forEach((h, j) => (row[h] = (cells[j] || '').trim()));
    if (!row['Date']) continue;
    const o: ParsedShot = { session: '', club: (row['Club Type'] || '').trim() };
    for (const [csvName, key] of Object.entries(FIELD_MAP)) {
      if (row[csvName] !== undefined && row[csvName] !== '') {
        const n = parseFloat(row[csvName]);
        if (!Number.isNaN(n)) (o as Record<string, unknown>)[key] = Math.round(n * 100) / 100;
      }
    }
    // parse date: "06/05/26 15:24:33 PM"
    const ds = (row['Date'] || '').replace(/\s*(AM|PM)\s*$/i, '').trim();
    const m = ds.match(/(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const yr = 2000 + +m[3];
      o._ts = new Date(yr, +m[1] - 1, +m[2], +m[4], +m[5], +m[6]);
    } else {
      o._ts = new Date();
    }
    out.push(o);
  }
  return out;
}

function sessionFromFile(shots: ParsedShot[]): RawShot[] {
  // each uploaded file = one session, labeled by date + start time
  const valid = shots.filter((s) => s._ts);
  if (!valid.length) return [];
  valid.sort((a, b) => (a._ts as Date).getTime() - (b._ts as Date).getTime());
  const startD = valid[0]._ts as Date;
  const pad = (n: number) => String(n).padStart(2, '0');
  const sid =
    startD.getFullYear() +
    '-' +
    pad(startD.getMonth() + 1) +
    '-' +
    pad(startD.getDate()) +
    '_' +
    pad(startD.getHours()) +
    pad(startD.getMinutes()) +
    '_u';
  const label =
    startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dateISO =
    startD.getFullYear() + '-' + pad(startD.getMonth() + 1) + '-' + pad(startD.getDate());
  return valid.map((s) => {
    const ts = (s._ts as Date).toISOString();
    const { _ts, ...rest } = s;
    return { ...rest, session: sid, session_label: label, date: dateISO, ts } as RawShot;
  });
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
  const [data, setData] = useState<RawData | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [clubState, setClubState] = useState<Record<string, boolean>>({});
  const [sessState, setSessState] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<string>('_idx');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [query, setQuery] = useState('');
  const [uploadMsg, setUploadMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const ingest = useCallback((d: RawData) => {
    setData(d);
    const nextRows: Row[] = d.shots.map((s, i) => ({
      ...s,
      _idx: i + 1,
      _color: d.colors[s.club] || C.dim,
    }));
    setRows(nextRows);
    setSessions(d.sessions);
    setClubState((prev) => {
      const cs = { ...prev };
      nextRows.forEach((r) => {
        if (!(r.club in cs)) cs[r.club] = true;
      });
      return cs;
    });
    setSessState((prev) => {
      const ss = { ...prev };
      d.sessions.forEach((s) => {
        if (!(s.id in ss)) ss[s.id] = true;
      });
      return ss;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    getRawData().then((d) => {
      if (alive) ingest(d);
    });
    return () => {
      alive = false;
    };
  }, [ingest]);

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

  const onUpload = useCallback(async () => {
    try {
      setBusy(true);
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/csv', '*/*'],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets || !res.assets.length) {
        setBusy(false);
        return;
      }
      setUploadMsg('Parsing ' + res.assets.length + ' file(s)…');
      const all: RawShot[] = [];
      for (const asset of res.assets) {
        const txt = asset.base64
          ? decodeBase64Utf8(asset.base64)
          : await new File(asset.uri).text();
        all.push(...sessionFromFile(parseCSV(txt)));
      }
      if (!all.length) {
        setUploadMsg('No valid shot rows found in those files.');
        setBusy(false);
        return;
      }
      // merge with existing uploaded, de-dupe by ts+club
      const existing = await loadUploaded();
      const seen = new Set(existing.map((s) => s.ts + '|' + s.club));
      const fresh = all.filter((s) => !seen.has(s.ts + '|' + s.club));
      const merged = [...existing, ...fresh];
      await saveUploaded(merged);
      setUploadMsg('Added ' + fresh.length + ' shots. Refreshing…');
      const d = await getRawData();
      ingest(d);
      setUploadMsg(fresh.length ? 'Added ' + fresh.length + ' shots.' : 'No new shots (all duplicates).');
    } catch (err) {
      setUploadMsg('Could not import (' + (err as Error).message + ').');
    } finally {
      setBusy(false);
    }
  }, [ingest]);

  if (!data) {
    return (
      <View style={[styles.page, styles.center]}>
        <ActivityIndicator color={C.accent} />
        <Text style={styles.loading}>Loading raw shots…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
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
          const col = data.colors[club] || C.dim;
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
            {shown.length === 0 ? (
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
  loading: { fontFamily: mono, fontSize: 12, color: C.dim, marginTop: 10 },

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

  foot: {
    fontFamily: mono,
    fontSize: 11,
    color: C.dim2,
    marginTop: 22,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
});
