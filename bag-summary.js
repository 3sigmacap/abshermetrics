// bag-summary.js — publish/read the aggregate "bag summary" that connections may see.
//
// A connection NEVER reads your raw shots (RLS keeps shots owner-only). Instead you
// publish an aggregated summary — the Overview columns per club + each club's average
// (mean) trajectory — into bag_summaries, which connections may read (RLS: own OR
// are_connected). Faithful peer of the mobile app's lib/bagSummary.tsx.
import { supabase, getSession } from './auth.js';
import { mean } from './club-compute.js';
import { loftOf } from './profile.js';

const r0 = (x) => Math.round(x);
const r1 = (x) => Math.round(x * 10) / 10;

/** Map computed ClubData[] -> the shareable summary array (AGGREGATES ONLY).
 *  carry/total/apex/descent + the mean trajectory are ENGINE-computed; ballSpeed/
 *  launchAngle/spin are the R50 launch inputs (means). No per-shot rows. */
export function buildSummary(clubData, clubSpecs = {}) {
  return (clubData || []).map((c) => {
    const st = c.stats || [];
    const col = (k) => st.map((s) => s[k]).filter((v) => typeof v === 'number');
    const bs = col('bs');
    const la = col('la');
    const sp = col('spin');
    return {
      club: c.club,
      color: c.color,
      n: c.n,
      carry: c.carry,
      total: c.total,
      apex: c.apex,
      descent: c.descent ?? 0,
      ballSpeed: bs.length ? r0(mean(bs)) : 0,
      launchAngle: la.length ? r1(mean(la)) : 0,
      spin: sp.length ? r0(mean(sp)) : 0,
      carrySD: c.ell ? c.ell.rx : 0,
      lateralSD: c.ell ? c.ell.rz : 0,
      loft: loftOf(clubSpecs, c.club),
      mean: c.mean || [],
    };
  });
}

/** Publish the signed-in user's aggregate summary (connections may read it).
 *  `profile` = { displayName, clubSpecs } (from loadProfile()). Best-effort. */
export async function publishBagSummary(clubData, profile = {}) {
  const session = await getSession();
  const uid = session?.user?.id;
  if (!uid) return { error: 'Not signed in' };
  const summary = buildSummary(clubData, profile.clubSpecs || {});
  const { error } = await supabase.from('bag_summaries').upsert(
    {
      user_id: uid,
      display_name: profile.displayName ?? null,
      summary,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  return error ? { error: error.message } : {};
}

/** Load a bag summary — your own, or a connection's (RLS enforces access).
 *  Returns { summary, displayName, updatedAt, missing? } or { error }. */
export async function loadBagSummary(userId) {
  const { data, error } = await supabase
    .from('bag_summaries')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { summary: [], displayName: '', updatedAt: null, missing: true };
  return {
    summary: data.summary || [],
    displayName: data.display_name || '',
    updatedAt: data.updated_at,
  };
}
