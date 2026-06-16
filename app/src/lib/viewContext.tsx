import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth';
import { useFollows, type FollowPerson } from '@/lib/follows';

/**
 * "Whose data am I looking at?" for the mobile app. A follower (spectator) can switch
 * the app to VIEW an approved followed player's account read-only. Defaults to SELF.
 * DataProvider + ProfileProvider read viewedUserId to scope their reads; writes always
 * target self. Must sit ABOVE DataProvider/ProfileProvider in the tree, and BELOW
 * AuthProvider + FollowsProvider (it consumes both).
 */
interface ViewState {
  viewedUserId: string | null; // user whose data to show (self by default)
  selfId: string | null;
  isViewingOther: boolean;
  following: FollowPerson[]; // approved players you follow (switch targets)
  setViewedUser: (id: string | null) => void; // null / self id => back to My data
}

const ViewContext = createContext<ViewState | undefined>(undefined);

export function ViewProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { following } = useFollows();
  const selfId = session?.user?.id ?? null;
  const [viewed, setViewed] = useState<string | null>(null); // null = self

  const players = useMemo(() => following.map((f) => f.other), [following]);

  // Self-heal: if viewing a player who is no longer an approved follow, reset to self.
  useEffect(() => {
    if (viewed && !players.some((p) => p.id === viewed)) setViewed(null);
  }, [viewed, players]);
  // Reset to self whenever the signed-in account changes.
  useEffect(() => {
    setViewed(null);
  }, [selfId]);

  const value = useMemo<ViewState>(
    () => ({
      viewedUserId: viewed || selfId,
      selfId,
      isViewingOther: !!(viewed && viewed !== selfId),
      following: players,
      setViewedUser: (id) => setViewed(id && id !== selfId ? id : null),
    }),
    [viewed, selfId, players],
  );

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useView(): ViewState {
  const v = useContext(ViewContext);
  if (!v) throw new Error('useView must be used within a <ViewProvider>');
  return v;
}
