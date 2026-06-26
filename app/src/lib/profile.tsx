import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/lib/auth';
import { useView } from '@/lib/viewContext';
import { DEFAULT_LOFTS } from '@/lib/clubData';
import { supabase } from '@/lib/supabase';

export interface ClubSpec {
  loft?: number;
  inBag?: boolean;
}
export interface AppPrefs {
  reduceMotion?: boolean;
  /** Receive push + email when a player you follow/connect with uploads a session.
   *  Undefined = on (default). Set false to opt out. */
  uploadAlerts?: boolean;
  /** Per-device mapping of a launch monitor's number-only club code to a canonical club
   *  (e.g. { foresight_gc3: { "52": "Gap Wedge" } }). Set once, applied to all imports. */
  clubMap?: Record<string, Record<string, string>>;
}

interface ProfileState {
  displayName: string;
  email: string;
  clubSpecs: Record<string, ClubSpec>;
  prefs: AppPrefs;
  loading: boolean;
  /** First-run flag for the signed-in user (NOT the viewed user): null while loading,
   *  false = show the "track vs follow" prompt, true = already chosen. */
  onboarded: boolean | null;
  /** loft for a club: user override, else standard default, else null */
  getLoft: (club: string) => number | null;
  inBag: (club: string) => boolean;
  updateName: (name: string) => Promise<{ error?: string }>;
  saveClubSpecs: (specs: Record<string, ClubSpec>) => Promise<{ error?: string }>;
  updatePrefs: (p: Partial<AppPrefs>) => Promise<{ error?: string }>;
  changePassword: (password: string) => Promise<{ error?: string }>;
  /** Mark the first-run prompt done (upserts profiles.onboarded = true for self). */
  completeOnboarding: () => Promise<void>;
}

const ProfileContext = createContext<ProfileState | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [clubSpecs, setClubSpecs] = useState<Record<string, ClubSpec>>({});
  const [prefs, setPrefs] = useState<AppPrefs>({});
  const [loading, setLoading] = useState(true);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  const email = session?.user?.email ?? '';
  const { viewedUserId, selfId } = useView();
  const uid = selfId; // writes ALWAYS target self; reads use the viewed user.

  // First-run flag is keyed to the SIGNED-IN user, independent of who we're viewing.
  useEffect(() => {
    let cancelled = false;
    if (!uid) {
      setOnboarded(null);
      return;
    }
    supabase
      .from('profiles')
      .select('onboarded')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        // No row yet / error → treat as not-onboarded (show the prompt) only when we
        // actually got a clean "missing" answer; on a hard error, skip the prompt.
        if (error) setOnboarded(true);
        else setOnboarded(data ? !!data.onboarded : false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const refresh = useCallback(async () => {
    if (!viewedUserId) {
      setDisplayName('');
      setClubSpecs({});
      setPrefs({});
      setLoading(false);
      return;
    }
    setLoading(true);
    // Load the VIEWED user's profile (their lofts/in-bag drive their bag when
    // spectating; self when not). select('*') tolerates missing columns.
    const { data, error } = await supabase.from('profiles').select('*').eq('id', viewedUserId).maybeSingle();
    if (!error && data) {
      setDisplayName((data.display_name as string) ?? '');
      setClubSpecs((data.club_specs as Record<string, ClubSpec>) ?? {});
      setPrefs((data.prefs as AppPrefs) ?? {});
    } else if (!error) {
      setDisplayName('');
      setClubSpecs({});
      setPrefs({});
    }
    setLoading(false);
  }, [viewedUserId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<ProfileState>(
    () => ({
      displayName,
      email,
      clubSpecs,
      prefs,
      loading,
      onboarded,
      getLoft: (club) => clubSpecs[club]?.loft ?? DEFAULT_LOFTS[club] ?? null,
      inBag: (club) => clubSpecs[club]?.inBag ?? true,
      updateName: async (name) => {
        if (!uid) return { error: 'Not signed in' };
        // upsert (not update) so the save never silently no-ops if the profile
        // row is somehow missing — the INSERT path passes RLS (auth.uid() = id).
        const { error } = await supabase
          .from('profiles')
          .upsert({ id: uid, display_name: name }, { onConflict: 'id' });
        if (error) return { error: error.message };
        setDisplayName(name);
        return {};
      },
      saveClubSpecs: async (specs) => {
        if (!uid) return { error: 'Not signed in' };
        const { error } = await supabase
          .from('profiles')
          .upsert({ id: uid, club_specs: specs }, { onConflict: 'id' });
        if (error) return { error: error.message };
        setClubSpecs(specs);
        return {};
      },
      updatePrefs: async (p) => {
        if (!uid) return { error: 'Not signed in' };
        const next = { ...prefs, ...p };
        const { error } = await supabase
          .from('profiles')
          .upsert({ id: uid, prefs: next }, { onConflict: 'id' });
        if (error) return { error: error.message };
        setPrefs(next);
        return {};
      },
      changePassword: async (password) => {
        const { error } = await supabase.auth.updateUser({ password });
        return error ? { error: error.message } : {};
      },
      completeOnboarding: async () => {
        if (!uid) return;
        // Upsert (not update) so it works even if the row is somehow missing.
        await supabase.from('profiles').upsert({ id: uid, onboarded: true }, { onConflict: 'id' });
        setOnboarded(true);
      },
    }),
    [displayName, email, clubSpecs, prefs, loading, onboarded, uid],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileState {
  const v = useContext(ProfileContext);
  if (!v) throw new Error('useProfile must be used within a <ProfileProvider>');
  return v;
}
