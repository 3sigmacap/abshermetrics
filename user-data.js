// user-data.js — load the SIGNED-IN user's shots/sessions from Supabase and shape
// them into the two formats the web pages already consume:
//   loadClubData() -> ClubData[]        (the bundled shots.json shape)
//   loadRawData()  -> {club_order, sessions, colors, shots}  (raw-shots.json shape)
//
// Faithful port of the mobile app's app/src/lib/dataStore.tsx. RLS guarantees the
// queries only ever return the current user's own rows.
import { supabase, getSession } from './auth.js';
import { parseDeviceFile, toShotRow, numericClubs } from './device-adapters.js';
import {
  computeClubs, CLUB_ORDER, CLUB_COLORS, clubColor, clubSortIdx,
} from './club-compute.js';
import { publishBagSummary } from './bag-summary.js';
import { loadProfile } from './profile.js';
import { getViewedUserId, isViewingOther } from './view-context.js';

export { CLUB_ORDER, clubSortIdx };

/** Recompute + republish this user's aggregate bag summary so connections see
 *  current numbers. Best-effort (never fails a mutation). Called after any data
 *  change; also runs on Bag load for users whose data predates this feature. */
export async function republishSummary() {
  // Only ever publish YOUR OWN summary. When spectating another player, loadClubData()
  // returns their data — never republish that as ours.
  if (await isViewingOther()) return;
  try {
    const [cd, profile] = await Promise.all([loadClubData(), loadProfile()]);
    await publishBagSummary(cd, profile);
  } catch (_) {
    /* non-fatal: summary refresh is best-effort */
  }
}

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
  // Scope to the VIEWED user (self by default; an approved followed player when
  // spectating). The explicit user_id filter is required now that follower-read RLS
  // is permissive — an unfiltered select would mix in every followed player's rows.
  const uid = await getViewedUserId();
  const { data: srows, error: se } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', uid)
    .order('date', { ascending: true });
  if (se) throw se;
  const { data: shotRows, error: she } = await supabase.from('shots').select('*').eq('user_id', uid);
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
    id: r.id,
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

  // Chronological order by the earliest shot TIME, not just date — two sessions on
  // the same day are ordered by their actual shot timestamps (the `date` column is
  // date-only). Keeps "first → latest" correct on Trends, etc.
  const firstTs = {};
  shots.forEach((s) => {
    if (s.session && s.ts && (firstTs[s.session] === undefined || s.ts < firstTs[s.session])) {
      firstTs[s.session] = s.ts;
    }
  });
  const sortKey = (s) => firstTs[s.id] ?? s.date ?? '';
  sessions.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

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
    await republishSummary();
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
    await republishSummary();
    return {};
  } catch (e) {
    return { error: e?.message ?? 'Failed to delete data' };
  }
}

/** Delete ONE shot by id (e.g. a launch-monitor error). RLS scopes it to the owner, so
 *  this can only ever delete your own shots. Republishes the bag summary afterward so
 *  connections see the corrected averages. */
export async function deleteShot(id) {
  if (!id) return { error: 'Missing shot id' };
  const { error } = await supabase.from('shots').delete().eq('id', id);
  if (error) return { error: error.message };
  await republishSummary();
  return {};
}

// ── launch-monitor file upload ──────────────────────────────────────────────
// Parsing is device-agnostic and SHARED with the native app (device-adapters.js,
// repo root). Each uploaded file = one session, tagged with its auto-detected device
// (Garmin R50, Foresight GC3, …). Abuse guard only: RLS scopes uploads to the uploader.
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file

/**
 * Upload launch-monitor File objects (from an <input type=file multiple>). Each file
 * becomes one session. The device is auto-detected per file. Returns {added, error?,
 * sessions, devices}. onProgress(msg) gets status text.
 */
export async function uploadCsvFiles(files, onProgress = () => {}, clubMaps = {}) {
  const session = await getSession();
  if (!session) return { added: 0, error: 'You must be signed in to upload.' };
  const uid = session.user.id;

  const fileEntries = []; // [{ device, shots }]
  let lastErr = '';
  for (const file of files) {
    if (file.size && file.size > MAX_FILE_BYTES) {
      onProgress('Skipped "' + (file.name ?? 'file') + '": larger than 10 MB.');
      continue;
    }
    const txt = await file.text();
    try {
      const { device, shots } = parseDeviceFile(txt, { clubMaps });
      if (shots.length) fileEntries.push({ device, shots });
      else lastErr = 'No valid shot rows found in "' + (file.name ?? 'file') + '".';
    } catch (e) {
      lastErr = (e && e.message) || 'Unrecognized file format.';
      onProgress('Skipped "' + (file.name ?? 'file') + '": ' + lastErr);
    }
  }
  if (!fileEntries.length) return { added: 0, error: lastErr || 'No valid shot rows found in those files.' };

  // Number-only clubs (e.g. GC3 "52") need a one-time user mapping before we import
  // anything — collect them per device and let the caller prompt, then re-upload.
  const need = {};
  for (const { device, shots } of fileEntries) {
    for (const code of numericClubs(shots)) (need[device] ||= new Set()).add(code);
  }
  if (Object.keys(need).length) {
    const needsMapping = {};
    for (const d of Object.keys(need)) needsMapping[d] = [...need[d]];
    return { added: 0, needsMapping };
  }

  let added = 0;
  let sessionsAdded = 0;
  const devices = new Set();
  for (const { device, shots } of fileEntries) {
    const first = shots[0];
    const label = first.session_label || first.session;
    const date = first.date ?? null;
    const { data: sess, error: se } = await supabase
      .from('sessions')
      .insert({ user_id: uid, label, date, device })
      .select('id')
      .single();
    if (se || !sess) return { added, error: 'Could not save session (' + (se?.message ?? 'unknown error') + ').' };

    const insertRows = shots.map((s) => toShotRow(s, { user_id: uid, session_id: sess.id }));
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
    devices.add(device);
    // Notify the uploader's approved followers + accepted connections that a new range
    // session landed (push + email). Fired per-session INSIDE the loop so a later file
    // failing (early return below) can't drop notifications for sessions already saved.
    // Best-effort, fire-and-forget — never blocks/fails the upload; the Edge Function is
    // idempotent (claims each session once) and verifies the caller owns it.
    supabase.functions.invoke('notify-new-session', { body: { sessionId: sess.id } }).catch(() => {});
  }
  await republishSummary();
  return { added, sessions: sessionsAdded, devices: [...devices] };
}
