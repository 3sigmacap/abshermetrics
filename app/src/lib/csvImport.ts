// Import a launch-monitor export (Garmin R50, Foresight GC3, …) as ONE session.
// The actual PARSING lives in the shared, device-agnostic module device-adapters.js
// (repo root, synced into src/shared/) so web + mobile parse identically. This file is
// just the mobile DB-insert side: parse → create session (tagged with the device) →
// insert shots (ball data + any club-head metrics + device). Used by the manual upload
// (raw-data screen) and the "share to AbsherMetrics" handler.
import { supabase } from '@/lib/supabase';
// @ts-ignore — plain-JS shared module (no type declarations). src/shared/ is a
// generated copy of repo-root device-adapters.js (see scripts/sync-shared.js).
import { parseDeviceFile, toShotRow } from '@/shared/device-adapters.js';

// Abuse guard. RLS already scopes any uploaded data to the uploader's own account, so
// this protects device memory + the shared DB quota, not isolation.
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file

const CHUNK = 500;

/**
 * Parse one launch-monitor file's text and insert it as a single session for `userId`.
 * Auto-detects the device. Returns { added, sessionLabel, device } or { added: 0, error }.
 * On a shot-insert failure the just-created (empty) session row is removed.
 */
export async function importCsvText(
  text: string,
  userId: string,
): Promise<{ added: number; sessionLabel?: string; device?: string; error?: string }> {
  let device: string;
  let shots: Array<Record<string, unknown>>;
  try {
    const res = parseDeviceFile(text);
    device = res.device;
    shots = res.shots;
  } catch (e) {
    return { added: 0, error: e instanceof Error ? e.message : 'Unrecognized file.' };
  }
  if (!shots.length) return { added: 0, error: 'No valid shot rows found in that file.' };

  const first = shots[0];
  const label = (first.session_label as string) || (first.session as string);
  const date = (first.date as string) ?? null;
  const { data: sess, error: se } = await supabase
    .from('sessions')
    .insert({ user_id: userId, label, date, device })
    .select('id')
    .single();
  if (se || !sess) {
    return { added: 0, error: 'Could not save session (' + (se?.message ?? 'unknown error') + ').' };
  }

  const rows = shots.map((s) => toShotRow(s, { user_id: userId, session_id: sess.id as string }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: ie } = await supabase.from('shots').insert(rows.slice(i, i + CHUNK));
    if (ie) {
      await supabase.from('sessions').delete().eq('id', sess.id);
      return { added: 0, error: 'Could not save shots (' + ie.message + ').' };
    }
  }
  // Notify the uploader's approved followers + accepted connections (push + email).
  // Best-effort, fire-and-forget — never blocks/fails the import.
  void supabase.functions.invoke('notify-new-session', { body: { sessionId: sess.id } }).catch(() => {});
  return { added: rows.length, sessionLabel: label, device };
}
