import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { type ClubData } from '@/data';
import { useAuth } from '@/lib/auth';
import { CLUB_COLORS, CLUB_ORDER, clubColor, computeClubs } from '@/lib/clubData';
import { supabase } from '@/lib/supabase';
import { useView } from '@/lib/viewContext';
import { type RawShot, type Session, SAMPLE_DATA } from '@/rawData';

/**
 * Loads the signed-in user's raw shots + sessions from Supabase and exposes them
 * in the SAME shapes the screens already consume:
 *   useClubs()   -> { clubs: ClubData[], loading }   (computed on-device, like @/data)
 *   useRawData() -> { shots, sessions, colors, clubOrder, loading, refresh }  (like getRawData())
 */
interface DataState {
  rawShots: RawShot[];
  sessions: Session[];
  clubs: ClubData[];
  colors: Record<string, string>;
  clubOrder: string[];
  loading: boolean;
  /** True only after the first authenticated fetch for this user has completed. */
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Seed the signed-in account with the bundled sample data (their own copy). */
  loadSampleData: () => Promise<{ error?: string }>;
  /** Delete ALL of the signed-in user's shots + sessions (keeps the account). */
  deleteAllData: () => Promise<{ error?: string }>;
  deleteShot: (id: string) => Promise<{ error?: string }>;
}

const DataContext = createContext<DataState | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { viewedUserId } = useView();
  const [rawShots, setRawShots] = useState<RawShot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // True only AFTER a real authenticated fetch has completed for the current user.
  // Guards the "no data → load sample" empty state so it never shows during the
  // sign-in → data handshake (when session is briefly null, or before the fetch runs).
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!session || !viewedUserId) {
      setRawShots([]);
      setSessions([]);
      setLoaded(false); // signed out / not restored yet — not a confirmed "empty account"
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Scope to the VIEWED user (self by default; an approved followed player when
      // spectating). Explicit user_id filter required now that follower-read RLS is
      // permissive — an unfiltered select would mix in followed players' rows.
      const { data: srows, error: se } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', viewedUserId)
        .order('date', { ascending: true });
      if (se) throw se;
      const { data: shotRows, error: she } = await supabase
        .from('shots')
        .select('*')
        .eq('user_id', viewedUserId);
      if (she) throw she;

      const sess: Session[] = (srows ?? []).map((s) => ({
        id: s.id as string,
        label: s.label as string,
        date: (s.date as string) ?? '',
      }));
      const labelOf: Record<string, string> = {};
      const dateOf: Record<string, string> = {};
      sess.forEach((s) => {
        labelOf[s.id] = s.label;
        dateOf[s.id] = s.date ?? '';
      });

      const shots: RawShot[] = (shotRows ?? []).map((r) => ({
        id: r.id as string,
        session: (r.session_id as string) ?? '',
        session_label: labelOf[r.session_id as string] ?? '',
        date: dateOf[r.session_id as string] ?? '',
        ts: (r.ts as string) ?? '',
        club: r.club as string,
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

      // Chronological order by the earliest shot TIME, not just date — two sessions
      // on the same day are ordered by their actual shot timestamps (the `date`
      // column is date-only). Keeps "first → latest" correct on Trends, etc.
      const firstTs: Record<string, string> = {};
      shots.forEach((s) => {
        if (s.session && s.ts && (firstTs[s.session] === undefined || s.ts < firstTs[s.session])) {
          firstTs[s.session] = s.ts;
        }
      });
      const sortKey = (s: Session) => firstTs[s.id] ?? s.date ?? '';
      sess.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

      setSessions(sess);
      setRawShots(shots);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoaded(true); // a fetch attempt for this signed-in user has completed
      setLoading(false);
    }
  }, [session, viewedUserId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadSampleData = useCallback(async (): Promise<{ error?: string }> => {
    if (!session) return { error: 'Not signed in' };
    const uid = session.user.id;
    try {
      // Create a session row per sample session, mapping old id -> new id.
      const idMap: Record<string, string> = {};
      for (const s of SAMPLE_DATA.sessions) {
        const { data, error: e } = await supabase
          .from('sessions')
          .insert({ user_id: uid, label: s.label, date: s.date || null })
          .select('id')
          .single();
        if (e) throw e;
        idMap[s.id] = data.id as string;
      }
      const rows = SAMPLE_DATA.shots.map((s) => ({
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
        excluded: Boolean(s.excluded),
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error: e } = await supabase.from('shots').insert(rows.slice(i, i + 500));
        if (e) throw e;
      }
      await refresh();
      return {};
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Failed to load sample data' };
    }
  }, [session, refresh]);

  const deleteAllData = useCallback(async (): Promise<{ error?: string }> => {
    if (!session) return { error: 'Not signed in' };
    const uid = session.user.id;
    try {
      // Shots first (sessions cascade-delete shots, but be explicit), then sessions.
      const { error: e1 } = await supabase.from('shots').delete().eq('user_id', uid);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('sessions').delete().eq('user_id', uid);
      if (e2) throw e2;
      await refresh();
      return {};
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Failed to delete data' };
    }
  }, [session, refresh]);

  // Delete ONE shot (e.g. a launch-monitor error). RLS scopes it to the owner. Removes
  // it locally immediately so the table updates without a full reload.
  const deleteShot = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      if (!session) return { error: 'Not signed in' };
      const { error } = await supabase.from('shots').delete().eq('id', id);
      if (error) return { error: error.message };
      setRawShots((prev) => prev.filter((s) => s.id !== id));
      return {};
    },
    [session],
  );

  const clubs = useMemo(() => computeClubs(rawShots), [rawShots]);
  const colors = useMemo(() => {
    const m: Record<string, string> = { ...CLUB_COLORS };
    rawShots.forEach((s, i) => {
      if (!m[s.club]) m[s.club] = clubColor(s.club, i);
    });
    return m;
  }, [rawShots]);

  const value = useMemo<DataState>(
    () => ({
      rawShots,
      sessions,
      clubs,
      colors,
      clubOrder: CLUB_ORDER,
      loading,
      loaded,
      error,
      refresh,
      loadSampleData,
      deleteAllData,
      deleteShot,
    }),
    [rawShots, sessions, clubs, colors, loading, loaded, error, refresh, loadSampleData, deleteAllData, deleteShot],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  const v = useContext(DataContext);
  if (!v) throw new Error('useData must be used within a <DataProvider>');
  return v;
}

/** Drop-in for the old `@/data` default export (per-user, computed on-device). */
export function useClubs(): { clubs: ClubData[]; loading: boolean } {
  const { clubs, loading, loaded } = useData();
  // Treat "not yet loaded" as still-loading so consumers never render an empty
  // state (e.g. the "load sample data" offer) during the sign-in → fetch handshake.
  return { clubs, loading: loading || !loaded };
}

/** Drop-in for the old getRawData() result. */
export function useRawData(): {
  shots: RawShot[];
  sessions: Session[];
  colors: Record<string, string>;
  clubOrder: string[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const { rawShots, sessions, colors, clubOrder, loading, loaded, refresh } = useData();
  return { shots: rawShots, sessions, colors, clubOrder, loading: loading || !loaded, refresh };
}

/** Mutating data actions: seed sample data / wipe all data. */
export function useDataActions(): {
  loadSampleData: () => Promise<{ error?: string }>;
  deleteAllData: () => Promise<{ error?: string }>;
  deleteShot: (id: string) => Promise<{ error?: string }>;
  hasData: boolean;
} {
  const { loadSampleData, deleteAllData, deleteShot, rawShots } = useData();
  return { loadSampleData, deleteAllData, deleteShot, hasData: rawShots.length > 0 };
}
