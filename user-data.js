// user-data.js — load the SIGNED-IN user's shots/sessions from Supabase and shape
// them into the two formats the web pages already consume:
//   loadClubData() -> ClubData[]        (the bundled shots.json shape)
//   loadRawData()  -> {club_order, sessions, colors, shots}  (raw-shots.json shape)
//
// Faithful port of the mobile app's app/src/lib/dataStore.tsx. RLS guarantees the
// queries only ever return the current user's own rows.
import { supabase, getSession } from './auth.js';
import {
  computeClubs, CLUB_ORDER, CLUB_COLORS, clubColor, clubSortIdx,
} from './club-compute.js';

export { CLUB_ORDER, clubSortIdx };

const CHUNK = 500; // rows per insert — mirrors the mobile app

/** HTML-escape a value before it is placed into innerHTML. Defense against stored
 *  XSS from attacker-controlled fields (e.g. a club name from an uploaded CSV).
 *  React Native auto-escapes; the vanilla web pages must do it explicitly. */
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Raw fetch: the user's sessions + shots, normalized to the RawShot/Session shapes. */
export async function fetchUserData() {
  const { data: srows, error: se } = await supabase
    .from('sessions')
    .select('*')
    .order('date', { ascending: true });
  if (se) throw se;
  const { data: shotRows, error: she } = await supabase.from('shots').select('*');
  if (she) throw she;

  const sessions = (srows ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    date: s.date ?? '',
    n: 0,
  }));
  const labelOf = {};
  const dateOf = {};
  sessions.forEach((s) => {
    labelOf[s.id] = s.label;
    dateOf[s.id] = s.date ?? '';
  });

  const shots = (shotRows ?? []).map((r) => ({
    session: r.session_id ?? '',
    session_label: labelOf[r.session_id] ?? '',
    date: dateOf[r.session_id] ?? '',
    ts: r.ts ?? '',
    club: r.club,
    bs: r.bs ?? undefined,
    la: r.la ?? undefined,
    ld: r.ld ?? undefined,
    bspin: r.bspin ?? undefined,
    sspin: r.sspin ?? undefined,
    spin: r.spin ?? undefined,
    axis: r.axis ?? undefined,
    apex: r.apex ?? undefined,
    carry: r.carry ?? undefined,
    total: r.total ?? undefined,
    dev: r.dev ?? undefined,
    excluded: Boolean(r.excluded),
  }));

  // session shot counts (for the raw-data session chips)
  const counts = {};
  shots.forEach((s) => {
    if (s.session) counts[s.session] = (counts[s.session] ?? 0) + 1;
  });
  sessions.forEach((s) => (s.n = counts[s.id] ?? 0));

  return { shots, sessions };
}

/** Per-club color map, data-driven (mirrors dataStore.tsx). */
export function colorsFor(shots) {
  const m = { ...CLUB_COLORS };
  shots.forEach((s, i) => {
    if (!m[s.club]) m[s.club] = clubColor(s.club, i);
  });
  return m;
}

/** Clubs present in the data, ASCENDING by length (shortest first) — matches the
 *  bundled club_order convention, but data-driven (includes a Driver if uploaded). */
export function clubOrderFor(shots) {
  const present = [...new Set(shots.map((s) => s.club))];
  // clubSortIdx is longest-first; ascending-by-length = descending clubSortIdx.
  present.sort((a, b) => clubSortIdx(b) - clubSortIdx(a));
  return present.length ? present : [...CLUB_ORDER];
}

/** ClubData[] (the shots.json shape) for the signed-in user. */
export async function loadClubData() {
  const { shots } = await fetchUserData();
  return computeClubs(shots);
}

/** {club_order, sessions, colors, shots} (the raw-shots.json shape). */
export async function loadRawData() {
  const { shots, sessions } = await fetchUserData();
  return {
    club_order: clubOrderFor(shots),
    sessions,
    colors: colorsFor(shots),
    shots,
  };
}

/** One round-trip variant: everything a page might need. */
export async function loadAll() {
  const { shots, sessions } = await fetchUserData();
  return {
    shots,
    sessions,
    colors: colorsFor(shots),
    club_order: clubOrderFor(shots),
    clubData: computeClubs(shots),
  };
}

// ── mutations (mirror app/src/lib/dataStore.tsx) ─────────────────────────────

/** Seed the signed-in account with the bundled sample data (their own copy).
 *  Mirrors dataStore.loadSampleData: the sample set is the bundled raw-shots.json. */
export async function loadSampleData() {
  const session = await getSession();
  if (!session) return { error: 'Not signed in' };
  const uid = session.user.id;
  try {
    const base = await (await fetch('./raw-shots.json')).json();
    const sampleSessions = base.sessions ?? [];
    const sampleShots = base.shots ?? [];
    // Create a session row per sample session, mapping old id -> new uuid.
    const idMap = {};
    for (const s of sampleSessions) {
      const { data, error } = await supabase
        .from('sessions')
        .insert({ user_id: uid, label: s.label, date: s.date || null })
        .select('id')
        .single();
      if (error) throw error;
      idMap[s.id] = data.id;
    }
    const rows = sampleShots.map((s) => ({
      user_id: uid,
      session_id: idMap[s.session] ?? null,
      club: s.club,
      ts: s.ts ?? null,
      bs: s.bs ?? null,
      la: s.la ?? null,
      ld: s.ld ?? null,
      bspin: s.bspin ?? null,
      sspin: s.sspin ?? null,
      spin: s.spin ?? null,
      axis: s.axis ?? null,
      apex: s.apex ?? null,
      carry: s.carry ?? null,
      total: s.total ?? null,
      dev: s.dev ?? null,
      excluded: Boolean(s.excluded), // sample is the ONLY insert path that sets excluded
    }));
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase.from('shots').insert(rows.slice(i, i + CHUNK));
      if (error) throw error;
    }
    return {};
  } catch (e) {
    return { error: e?.message ?? 'Failed to load sample data' };
  }
}

/** Delete ALL of the signed-in user's shots + sessions (keeps the account).
 *  Shots first, then sessions; .eq('user_id') kept as defense-in-depth with RLS. */
export async function deleteAllData() {
  const session = await getSession();
  if (!session) return { error: 'Not signed in' };
  const uid = session.user.id;
  try {
    const { error: e1 } = await supabase.from('shots').delete().eq('user_id', uid);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from('sessions').delete().eq('user_id', uid);
    if (e2) throw e2;
    return {};
  } catch (e) {
    return { error: e?.message ?? 'Failed to delete data' };
  }
}

// ── CSV upload (byte-faithful port of app/src/app/raw-data.tsx) ──────────────
// Each uploaded file = one session. Garmin R50 export column -> internal key.
const FIELD_MAP = {
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
// Abuse guards: RLS scopes uploads to the uploader, so these protect memory + DB quota.
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_ROWS = 10_000; // per file

function parseCSV(text) {
  const lines = text
    .replace(/^﻿/, '') // strip UTF-8 BOM
    .split(/\r?\n/)
    .filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim());
  // detect & skip a units row (second row where the Date cell is empty)
  let start = 1;
  const secondCells = lines[1].split(',');
  if (!secondCells[0].trim()) start = 2;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const row = {};
    head.forEach((h, j) => (row[h] = (cells[j] || '').trim()));
    if (!row['Date']) continue;
    // strip < > and cap length so a club name can never inject markup downstream
    const o = { session: '', club: (row['Club Type'] || '').trim().replace(/[<>]/g, '').slice(0, 40) };
    for (const [csvName, key] of Object.entries(FIELD_MAP)) {
      if (row[csvName] !== undefined && row[csvName] !== '') {
        const n = parseFloat(row[csvName]);
        const r = Math.round(n * 100) / 100;
        // round THEN check: Number.isFinite rejects NaN AND Infinity (e.g. "1e308").
        if (Number.isFinite(r)) o[key] = r;
      }
    }
    // parse date: "06/05/26 15:24:33 PM" — discard AM/PM, build in LOCAL time, yr=2000+YY
    const ds = (row['Date'] || '').replace(/\s*(AM|PM)\s*$/i, '').trim();
    const m = ds.match(/(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const yr = 2000 + +m[3];
      o._ts = new Date(yr, +m[1] - 1, +m[2], +m[4], +m[5], +m[6]);
    } else {
      o._ts = new Date();
    }
    out.push(o);
    if (out.length >= MAX_ROWS) break;
  }
  return out;
}

function sessionFromFile(shots) {
  const valid = shots.filter((s) => s._ts);
  if (!valid.length) return [];
  valid.sort((a, b) => a._ts.getTime() - b._ts.getTime());
  const startD = valid[0]._ts;
  const pad = (n) => String(n).padStart(2, '0');
  const sid =
    startD.getFullYear() + '-' + pad(startD.getMonth() + 1) + '-' + pad(startD.getDate()) +
    '_' + pad(startD.getHours()) + pad(startD.getMinutes()) + '_u';
  const label =
    startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dateISO =
    startD.getFullYear() + '-' + pad(startD.getMonth() + 1) + '-' + pad(startD.getDate());
  return valid.map((s) => {
    const ts = s._ts.toISOString();
    const { _ts, ...rest } = s;
    return { ...rest, session: sid, session_label: label, date: dateISO, ts };
  });
}

/**
 * Upload CSV File objects (from an <input type=file multiple>). Each file becomes
 * one session. Returns {added, error?, sessions}. onProgress(msg) gets status text.
 * cs/smash are parsed but NEVER inserted; excluded defaults false server-side.
 */
export async function uploadCsvFiles(files, onProgress = () => {}) {
  const session = await getSession();
  if (!session) return { added: 0, error: 'You must be signed in to upload.' };
  const uid = session.user.id;

  const fileShots = [];
  for (const file of files) {
    if (file.size && file.size > MAX_FILE_BYTES) {
      onProgress('Skipped "' + (file.name ?? 'file') + '": larger than 10 MB.');
      continue;
    }
    const txt = await file.text();
    const parsed = sessionFromFile(parseCSV(txt));
    if (parsed.length) fileShots.push(parsed);
  }
  if (!fileShots.length) return { added: 0, error: 'No valid shot rows found in those files.' };

  let added = 0;
  let sessionsAdded = 0;
  for (const parsedShots of fileShots) {
    const first = parsedShots[0];
    const label = first.session_label || first.session;
    const date = first.date ?? null;
    const { data: sess, error: se } = await supabase
      .from('sessions')
      .insert({ user_id: uid, label, date })
      .select('id')
      .single();
    if (se || !sess) return { added, error: 'Could not save session (' + (se?.message ?? 'unknown error') + ').' };

    const insertRows = parsedShots.map((s) => ({
      user_id: uid,
      session_id: sess.id,
      club: s.club,
      ts: s.ts ?? null,
      bs: s.bs ?? null,
      la: s.la ?? null,
      ld: s.ld ?? null,
      bspin: s.bspin ?? null,
      sspin: s.sspin ?? null,
      spin: s.spin ?? null,
      axis: s.axis ?? null,
      apex: s.apex ?? null,
      carry: s.carry ?? null,
      total: s.total ?? null,
      dev: s.dev ?? null,
    }));
    for (let i = 0; i < insertRows.length; i += CHUNK) {
      const { error: ie } = await supabase.from('shots').insert(insertRows.slice(i, i + CHUNK));
      if (ie) {
        // cleanliness: drop the just-created session so we don't orphan an empty one
        await supabase.from('sessions').delete().eq('id', sess.id);
        return { added, error: 'Could not save shots (' + ie.message + ').' };
      }
    }
    added += insertRows.length;
    sessionsAdded += 1;
  }
  return { added, sessions: sessionsAdded };
}
