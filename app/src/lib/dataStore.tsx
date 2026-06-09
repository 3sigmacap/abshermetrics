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
import { type RawShot, type Session } from '@/rawData';

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
  error: string | null;
  refresh: () => Promise<void>;
}

const DataContext = createContext<DataState | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [rawShots, setRawShots] = useState<RawShot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setRawShots([]);
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: srows, error: se } = await supabase
        .from('sessions')
        .select('*')
        .order('date', { ascending: true });
      if (se) throw se;
      const { data: shotRows, error: she } = await supabase.from('shots').select('*');
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

      setSessions(sess);
      setRawShots(shots);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const clubs = useMemo(() => computeClubs(rawShots), [rawShots]);
  const colors = useMemo(() => {
    const m: Record<string, string> = { ...CLUB_COLORS };
    rawShots.forEach((s, i) => {
      if (!m[s.club]) m[s.club] = clubColor(s.club, i);
    });
    return m;
  }, [rawShots]);

  const value = useMemo<DataState>(
    () => ({ rawShots, sessions, clubs, colors, clubOrder: CLUB_ORDER, loading, error, refresh }),
    [rawShots, sessions, clubs, colors, loading, error, refresh],
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
  const { clubs, loading } = useData();
  return { clubs, loading };
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
  const { rawShots, sessions, colors, clubOrder, loading, refresh } = useData();
  return { shots: rawShots, sessions, colors, clubOrder, loading, refresh };
}
