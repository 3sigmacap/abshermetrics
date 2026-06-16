// view-context.js — "whose data am I looking at?" for the web app.
//
// A FOLLOWER (spectator) can switch the app to VIEW an approved followed player's
// account read-only. The viewed user id is stored in localStorage; it defaults to
// SELF. All data READS funnel through getViewedUserId() (user-data.js / profile.js);
// all WRITES always target self, and the write UI is hidden while viewing someone
// else (RLS also blocks writing another user's data, so it's safe regardless).
import { getSession } from './auth.js';

const KEY = 'am-viewed-user';

/** The signed-in user's own id. */
export async function selfId() {
  const s = await getSession();
  return s?.user?.id ?? null;
}

/** The user whose data the app should currently SHOW. Defaults to self. */
export async function getViewedUserId() {
  const me = await selfId();
  if (!me) return null;
  const stored = localStorage.getItem(KEY);
  return stored && stored !== me ? stored : me;
}

/** True when viewing an approved followed player (not your own account). */
export async function isViewingOther() {
  const me = await selfId();
  const stored = localStorage.getItem(KEY);
  return !!(stored && stored !== me);
}

/** Switch which account we're viewing. Pass null / self id to return to My data. */
export async function setViewedUserId(id) {
  const me = await selfId();
  if (!id || id === me) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, id);
}

export function rawStoredViewedUser() {
  return localStorage.getItem(KEY);
}
