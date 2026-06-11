// Shared CSV import: parse a Garmin R50 export and insert it as ONE session.
// Used by the manual upload (raw-data screen) AND the "share to AbsherMetrics" handler
// so a shared CSV imports identically to an in-app upload. Byte-faithful port of the
// web user-data.js parser.
import { supabase } from '@/lib/supabase';
import { type RawShot } from '@/rawData';

// Garmin Approach R50 export column -> internal key.
export const FIELD_MAP: Record<string, string> = {
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

// Abuse guards. RLS already scopes any uploaded data to the uploader's own account,
// so these protect device memory + the shared DB quota, not isolation.
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_ROWS = 10_000; // per file

export function parseCSV(text: string): ParsedShot[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim());
  // detect & skip a units row (second row where the Date cell is empty)
  let start = 1;
  const secondCells = lines[1].split(',');
  if (!secondCells[0].trim()) start = 2;
  const out: ParsedShot[] = [];
  for (let i = start; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const row: Record<string, string> = {};
    head.forEach((h, j) => (row[h] = (cells[j] || '').trim()));
    if (!row['Date']) continue;
    // strip < > and cap length so a club name can never inject markup downstream
    const o: ParsedShot = {
      session: '',
      club: (row['Club Type'] || '').trim().replace(/[<>]/g, '').slice(0, 40),
    };
    for (const [csvName, key] of Object.entries(FIELD_MAP)) {
      if (row[csvName] !== undefined && row[csvName] !== '') {
        const n = parseFloat(row[csvName]);
        const r = Math.round(n * 100) / 100;
        // round THEN check: Number.isFinite rejects NaN AND Infinity (e.g. "1e308").
        if (Number.isFinite(r)) (o as Record<string, unknown>)[key] = r;
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

export function sessionFromFile(shots: ParsedShot[]): RawShot[] {
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

/**
 * Parse one CSV file's text and insert it as a single session for `userId`.
 * Returns { added, sessionLabel } or { added: 0, error }. On a shot-insert failure
 * the just-created (empty) session row is removed so nothing is orphaned.
 */
export async function importCsvText(
  text: string,
  userId: string,
): Promise<{ added: number; sessionLabel?: string; error?: string }> {
  const parsed = sessionFromFile(parseCSV(text));
  if (!parsed.length) return { added: 0, error: 'No valid shot rows found in that file.' };

  const first = parsed[0];
  const label = first.session_label || first.session;
  const date = first.date ?? null;
  const { data: sess, error: se } = await supabase
    .from('sessions')
    .insert({ user_id: userId, label, date })
    .select('id')
    .single();
  if (se || !sess) {
    return { added: 0, error: 'Could not save session (' + (se?.message ?? 'unknown error') + ').' };
  }

  const rows = parsed.map((s) => ({
    user_id: userId,
    session_id: sess.id as string,
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
  for (let i = 0; i < rows.length; i += 500) {
    const { error: ie } = await supabase.from('shots').insert(rows.slice(i, i + 500));
    if (ie) {
      await supabase.from('sessions').delete().eq('id', sess.id);
      return { added: 0, error: 'Could not save shots (' + ie.message + ').' };
    }
  }
  return { added: rows.length, sessionLabel: label };
}
