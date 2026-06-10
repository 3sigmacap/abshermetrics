import { useEffect, useRef } from 'react';

import { type ClubData } from '@/data';
import { useAuth } from '@/lib/auth';
import { DEFAULT_LOFTS } from '@/lib/clubData';
import { useClubs } from '@/lib/dataStore';
import { useProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { mean, r0, r1 } from '@/lib/format';

/**
 * Publish/read the aggregate "bag summary" that connections may see. A connection
 * NEVER reads raw shots (RLS keeps shots owner-only); instead each user publishes
 * an aggregated summary (Overview columns per club + each club's mean trajectory)
 * into bag_summaries. Faithful peer of the web app's bag-summary.js.
 */
export interface BagSummaryClub {
  club: string;
  color: string;
  n: number;
  carry: number;
  total: number;
  apex: number;
  descent: number;
  ballSpeed: number;
  launchAngle: number;
  spin: number;
  carrySD: number;
  lateralSD: number;
  loft: number | null;
  mean: number[];
}

const loftOf = (clubSpecs: Record<string, { loft?: number }>, club: string): number | null =>
  clubSpecs?.[club]?.loft ?? DEFAULT_LOFTS[club] ?? null;

/** Map computed ClubData[] -> the shareable summary array (AGGREGATES ONLY). */
export function buildSummary(
  clubs: ClubData[],
  clubSpecs: Record<string, { loft?: number }> = {},
): BagSummaryClub[] {
  return (clubs || []).map((c) => {
    const col = (k: 'bs' | 'la' | 'spin') =>
      c.stats.map((s) => s[k]).filter((v): v is number => v != null);
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

/** Upsert the signed-in user's aggregate summary. Best-effort. */
export async function publishBagSummary(
  uid: string,
  clubs: ClubData[],
  displayName: string,
  clubSpecs: Record<string, { loft?: number }>,
): Promise<{ error?: string }> {
  const summary = buildSummary(clubs, clubSpecs);
  const { error } = await supabase.from('bag_summaries').upsert(
    { user_id: uid, display_name: displayName || null, summary, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
  return error ? { error: error.message } : {};
}

/** Load a bag summary — your own, or a connection's (RLS enforces access). */
export async function loadBagSummary(userId: string): Promise<{
  summary: BagSummaryClub[];
  displayName: string;
  updatedAt: string | null;
  missing?: boolean;
  error?: string;
}> {
  const { data, error } = await supabase
    .from('bag_summaries')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { summary: [], displayName: '', updatedAt: null, error: error.message };
  if (!data) return { summary: [], displayName: '', updatedAt: null, missing: true };
  return {
    summary: (data.summary as BagSummaryClub[]) || [],
    displayName: (data.display_name as string) || '',
    updatedAt: data.updated_at as string,
  };
}

/**
 * Mount once inside the providers (see _layout). Auto-publishes the signed-in
 * user's summary whenever their clubs or profile change — covering uploads,
 * sample load, delete-all, loft edits, and users whose data predates this
 * feature. Renders nothing. Skips the no-op publish for brand-new empty bags.
 */
export function BagPublisher() {
  const { session } = useAuth();
  const { clubs, loading } = useClubs();
  const profile = useProfile();
  const lastRef = useRef<string>('');
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid || loading || profile.loading) return;
    const summary = buildSummary(clubs, profile.clubSpecs);
    if (summary.length === 0 && lastRef.current === '') return; // never published, still empty
    const sig = JSON.stringify({ d: profile.displayName, s: summary });
    if (sig === lastRef.current) return;
    lastRef.current = sig;
    supabase
      .from('bag_summaries')
      .upsert(
        { user_id: uid, display_name: profile.displayName || null, summary, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
      .then(
        () => {},
        () => {},
      );
  }, [session, clubs, loading, profile.loading, profile.displayName, profile.clubSpecs]);
  return null;
}
