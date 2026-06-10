// profile.js — per-user profile (display name, club lofts/in-bag, prefs, password).
// Faithful port of the mobile app's app/src/lib/profile.tsx. All writes UPSERT the
// profiles row (onConflict 'id') so a save never silently no-ops; the INSERT path
// passes RLS because auth.uid() = id.
import { supabase, getSession } from './auth.js';
import { DEFAULT_LOFTS } from './club-compute.js';

export { DEFAULT_LOFTS };

/** Loft resolution: per-club override, else standard default, else null. */
export const loftOf = (clubSpecs, club) => clubSpecs?.[club]?.loft ?? DEFAULT_LOFTS[club] ?? null;
/** In-bag resolution: per-club override, else TRUE (clubs default to in the bag). */
export const inBagOf = (clubSpecs, club) => clubSpecs?.[club]?.inBag ?? true;

/** Load the signed-in user's profile row (display name, club_specs, prefs). */
export async function loadProfile() {
  const session = await getSession();
  const email = session?.user?.email ?? '';
  const uid = session?.user?.id;
  if (!uid) return { displayName: '', email, clubSpecs: {}, prefs: {} };
  // select('*') so it works even if club_specs/prefs columns aren't present yet.
  const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
  return {
    displayName: data?.display_name ?? '',
    email,
    clubSpecs: data?.club_specs ?? {},
    prefs: data?.prefs ?? {},
  };
}

export async function updateName(name) {
  const session = await getSession();
  const uid = session?.user?.id;
  if (!uid) return { error: 'Not signed in' };
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: uid, display_name: name }, { onConflict: 'id' });
  return error ? { error: error.message } : {};
}

export async function saveClubSpecs(specs) {
  const session = await getSession();
  const uid = session?.user?.id;
  if (!uid) return { error: 'Not signed in' };
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: uid, club_specs: specs }, { onConflict: 'id' });
  return error ? { error: error.message } : {};
}

/** Pass the COMPLETE next prefs object (caller merges) — upserts profiles.prefs. */
export async function updatePrefs(nextPrefs) {
  const session = await getSession();
  const uid = session?.user?.id;
  if (!uid) return { error: 'Not signed in' };
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: uid, prefs: nextPrefs }, { onConflict: 'id' });
  return error ? { error: error.message } : {};
}

export async function changePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  return error ? { error: error.message } : {};
}

/** Delete the whole account via the privileged Edge Function (never client-side).
 *  Caller signs out on success. */
export async function deleteAccount() {
  const { error } = await supabase.functions.invoke('delete-account');
  return error ? { error: error.message || 'Unknown error' } : {};
}

// Limit loft to at most 2 integer digits + one decimal (e.g. 10.5, 56, 42.5) — a
// loft can only be 2 digits, never 100 or 12.345. EXACT port of settings.tsx.
export function sanitizeLoft(t) {
  let s = String(t).replace(/[^0-9.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  const [intPart = '', decPart = ''] = s.split('.');
  let out = intPart.slice(0, 2);
  if (s.includes('.')) out += '.' + decPart.slice(0, 1);
  return out;
}
