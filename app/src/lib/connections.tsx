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
 * Player-to-player connections (MUTUAL). Once accepted, both players can read
 * each other's aggregated bag_summary — never raw shots. Faithful peer of the
 * web app's connections.js.
 *
 * Requesting by email goes through the `request-connection` Edge Function (the
 * client can't resolve an email -> user id under RLS). Accept/decline/remove are
 * plain table ops done directly (RLS enforces who may do what).
 */
export interface ConnPerson {
  id: string;
  name: string | null;
  email: string | null;
}
export interface ConnItem {
  id: string;
  other: ConnPerson;
  status: string;
  createdAt: string;
}

interface ConnState {
  accepted: ConnItem[];
  pendingIn: ConnItem[]; // someone requested ME — I accept/decline
  pendingOut: ConnItem[]; // I requested someone — awaiting them
  pendingCount: number; // incoming pending (for the tab badge)
  loading: boolean;
  refresh: () => Promise<void>;
  /** status: 'requested' | 'accepted' | 'already' | 'self' | 'invited' | 'invite_failed'.
   *  'invited' = no account yet → an email invite was sent + a pending connection
   *  created; 'invite_failed' = the invite email couldn't be sent (SMTP not set up). */
  request: (email: string) => Promise<{ status?: string; error?: string }>;
  accept: (id: string) => Promise<{ error?: string }>;
  decline: (id: string) => Promise<{ error?: string }>;
  remove: (id: string) => Promise<{ error?: string }>;
}

const ConnectionsContext = createContext<ConnState | undefined>(undefined);

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [accepted, setAccepted] = useState<ConnItem[]>([]);
  const [pendingIn, setPendingIn] = useState<ConnItem[]>([]);
  const [pendingOut, setPendingOut] = useState<ConnItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!uid) {
      setAccepted([]);
      setPendingIn([]);
      setPendingOut([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('connections')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) {
      const a: ConnItem[] = [];
      const pin: ConnItem[] = [];
      const pout: ConnItem[] = [];
      for (const c of data) {
        const iAmRequester = c.requester_id === uid;
        const other: ConnPerson = iAmRequester
          ? { id: c.addressee_id as string, name: c.addressee_name ?? null, email: c.addressee_email ?? null }
          : { id: c.requester_id as string, name: c.requester_name ?? null, email: c.requester_email ?? null };
        const item: ConnItem = { id: c.id as string, other, status: c.status as string, createdAt: c.created_at as string };
        if (c.status === 'accepted') a.push(item);
        else if (iAmRequester) pout.push(item);
        else pin.push(item);
      }
      setAccepted(a);
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
      const { data, error } = await supabase.functions.invoke('request-connection', { body: { email: e } });
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

  const accept = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      const { error } = await supabase
        .from('connections')
        .update({ status: 'accepted', responded_at: new Date().toISOString() })
        .eq('id', id);
      if (error) return { error: error.message };
      // Push the requester's device that you accepted (best-effort).
      try {
        await supabase.functions.invoke('notify-accept', { body: { connectionId: id } });
      } catch {
        /* non-fatal */
      }
      await refresh();
      return {};
    },
    [refresh],
  );

  const removeRow = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      const { error } = await supabase.from('connections').delete().eq('id', id);
      if (error) return { error: error.message };
      await refresh();
      return {};
    },
    [refresh],
  );

  const value = useMemo<ConnState>(
    () => ({
      accepted,
      pendingIn,
      pendingOut,
      pendingCount: pendingIn.length,
      loading,
      refresh,
      request,
      accept,
      decline: removeRow,
      remove: removeRow,
    }),
    [accepted, pendingIn, pendingOut, loading, refresh, request, accept, removeRow],
  );

  return <ConnectionsContext.Provider value={value}>{children}</ConnectionsContext.Provider>;
}

export function useConnections(): ConnState {
  const v = useContext(ConnectionsContext);
  if (!v) throw new Error('useConnections must be used within a <ConnectionsProvider>');
  return v;
}
