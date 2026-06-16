// follows.js — "spectator / follow" relationships for the AbsherMetrics web app.
//
// A FOLLOW is one-directional: the follower VIEWS the followed user's full account
// read-only (raw shots included) once the followed user APPROVES. Distinct from
// connections (mutual, aggregate-only). Faithful peer of mobile lib/follows.tsx.
//
// Requesting by email goes through the `follow-request` Edge Function (the client
// can't resolve an email -> user id under RLS). Approve is a direct UPDATE the
// followed user does (RLS: only the followed may flip pending -> approved); deny /
// revoke / cancel are deletes (RLS allows either participant to delete).
import { supabase, getSession } from './auth.js';

/** Ask to follow an email. Returns { status } or { error }.
 *  status: 'requested' | 'already' | 'self' | 'not_found'. */
export async function requestFollow(email) {
  const e = String(email || '').trim();
  if (!e) return { error: 'Enter an email address.' };
  const { data, error } = await supabase.functions.invoke('follow-request', { body: { email: e } });
  if (error) {
    let msg = error.message || 'Request failed';
    try {
      const ctx = error.context && (await error.context.json());
      if (ctx?.error) msg = ctx.error;
    } catch (_) { /* keep msg */ }
    return { error: msg };
  }
  return { status: data?.status };
}

/** All of the caller's follow rows, partitioned. RLS returns only rows where the
 *  caller is a participant. Returns { following, followers, pendingIn, pendingOut }.
 *   - following : approved follows where I am the follower (players I can view)
 *   - followers : approved follows where I am the followed (people viewing me)
 *   - pendingIn : pending where I am the followed (requests I approve/deny)
 *   - pendingOut: pending where I am the follower (I asked; awaiting their approval) */
export async function listFollows() {
  const session = await getSession();
  const uid = session?.user?.id;
  if (!uid) return { following: [], followers: [], pendingIn: [], pendingOut: [] };
  const { data, error } = await supabase
    .from('follows')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return { following: [], followers: [], pendingIn: [], pendingOut: [], error: error.message };

  const following = [];
  const followers = [];
  const pendingIn = [];
  const pendingOut = [];
  for (const f of data || []) {
    const iAmFollower = f.follower_id === uid;
    const other = iAmFollower
      ? { id: f.followed_id, name: f.followed_name, email: f.followed_email }
      : { id: f.follower_id, name: f.follower_name, email: f.follower_email };
    const item = { id: f.id, other, status: f.status, createdAt: f.created_at };
    if (f.status === 'approved') (iAmFollower ? following : followers).push(item);
    else (iAmFollower ? pendingOut : pendingIn).push(item);
  }
  return { following, followers, pendingIn, pendingOut };
}

/** Approve an incoming follow request (RLS: only the followed user may do this). */
export async function approveFollow(id) {
  const { error } = await supabase
    .from('follows')
    .update({ status: 'approved', responded_at: new Date().toISOString() })
    .eq('id', id);
  return error ? { error: error.message } : {};
}

/** Delete a follow row — deny (incoming), cancel (outgoing), revoke (approved), or
 *  stop following. RLS allows either participant to delete. */
export async function removeFollow(id) {
  const { error } = await supabase.from('follows').delete().eq('id', id);
  return error ? { error: error.message } : {};
}
export const denyFollow = removeFollow;

/** Count of incoming pending follow requests (for the Settings badge). */
export async function pendingFollowCount() {
  const session = await getSession();
  const uid = session?.user?.id;
  if (!uid) return 0;
  const { count, error } = await supabase
    .from('follows')
    .select('id', { count: 'exact', head: true })
    .eq('followed_id', uid)
    .eq('status', 'pending');
  return error ? 0 : count || 0;
}
