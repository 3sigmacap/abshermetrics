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
import { supabase } from '@/lib/supabase';

/**
 * "Spectator / follow" relationships. A follow is one-directional: the follower
 * VIEWS the followed user's full account read-only (raw shots included) once the
 * followed user APPROVES. Distinct from connections (mutual, aggregate-only).
 * Faithful peer of the web app's follows.js.
 */
export interface FollowPerson {
  id: string;
  name: string | null;
  email: string | null;
}
export interface FollowItem {
  id: string;
  other: FollowPerson;
  status: string;
  createdAt: string;
}

interface FollowsState {
  following: FollowItem[]; // approved — players I can view
  followers: FollowItem[]; // approved — people viewing me
  pendingIn: FollowItem[]; // pending — requests for me to approve
  pendingOut: FollowItem[]; // pending — I asked; awaiting approval
  pendingCount: number; // incoming pending (for the badge)
  loading: boolean;
  refresh: () => Promise<void>;
  /** status: 'requested' | 'already' | 'self' | 'not_found'. */
  request: (email: string) => Promise<{ status?: string; error?: string }>;
  approve: (id: string) => Promise<{ error?: string }>;
  deny: (id: string) => Promise<{ error?: string }>;
  remove: (id: string) => Promise<{ error?: string }>;
}

const FollowsContext = createContext<FollowsState | undefined>(undefined);

export function FollowsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [following, setFollowing] = useState<FollowItem[]>([]);
  const [followers, setFollowers] = useState<FollowItem[]>([]);
  const [pendingIn, setPendingIn] = useState<FollowItem[]>([]);
  const [pendingOut, setPendingOut] = useState<FollowItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!uid) {
      setFollowing([]);
      setFollowers([]);
      setPendingIn([]);
      setPendingOut([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('follows')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) {
      const fin: FollowItem[] = [];
      const fers: FollowItem[] = [];
      const pin: FollowItem[] = [];
      const pout: FollowItem[] = [];
      for (const f of data) {
        const iAmFollower = f.follower_id === uid;
        const other: FollowPerson = iAmFollower
          ? { id: f.followed_id as string, name: f.followed_name ?? null, email: f.followed_email ?? null }
          : { id: f.follower_id as string, name: f.follower_name ?? null, email: f.follower_email ?? null };
        const item: FollowItem = { id: f.id as string, other, status: f.status as string, createdAt: f.created_at as string };
        if (f.status === 'approved') (iAmFollower ? fin : fers).push(item);
        else (iAmFollower ? pout : pin).push(item);
      }
      setFollowing(fin);
      setFollowers(fers);
      setPendingIn(pin);
      setPendingOut(pout);
    }
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const request = useCallback(
    async (email: string): Promise<{ status?: string; error?: string }> => {
      const e = email.trim();
      if (!e) return { error: 'Enter an email address.' };
      const { data, error } = await supabase.functions.invoke('follow-request', { body: { email: e } });
      if (error) {
        let msg = error.message || 'Request failed';
        try {
          const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
          const body = ctx?.json ? await ctx.json() : null;
          if (body?.error) msg = body.error;
        } catch {
          /* keep msg */
        }
        return { error: msg };
      }
      await refresh();
      return { status: (data as { status?: string } | null)?.status };
    },
    [refresh],
  );

  const approve = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      const { error } = await supabase
        .from('follows')
        .update({ status: 'approved', responded_at: new Date().toISOString() })
        .eq('id', id);
      if (error) return { error: error.message };
      await refresh();
      return {};
    },
    [refresh],
  );

  const removeRow = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      const { error } = await supabase.from('follows').delete().eq('id', id);
      if (error) return { error: error.message };
      await refresh();
      return {};
    },
    [refresh],
  );

  const value = useMemo<FollowsState>(
    () => ({
      following,
      followers,
      pendingIn,
      pendingOut,
      pendingCount: pendingIn.length,
      loading,
      refresh,
      request,
      approve,
      deny: removeRow,
      remove: removeRow,
    }),
    [following, followers, pendingIn, pendingOut, loading, refresh, request, approve, removeRow],
  );

  return <FollowsContext.Provider value={value}>{children}</FollowsContext.Provider>;
}

export function useFollows(): FollowsState {
  const v = useContext(FollowsContext);
  if (!v) throw new Error('useFollows must be used within a <FollowsProvider>');
  return v;
}
