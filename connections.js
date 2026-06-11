// connections.js — player-to-player connections for the AbsherMetrics web app.
//
// Connections are MUTUAL: once accepted, both players can read each other's
// aggregated bag_summary (never raw shots). This module lists/creates/accepts/
// removes connections. Faithful peer of the mobile app's lib/connections.tsx.
//
// Requesting by email goes through the `request-connection` Edge Function (the
// client can't resolve an email -> user id under RLS). Accept/decline/remove are
// plain table ops the client does directly (RLS enforces who may do what).
import { supabase, getSession } from './auth.js';

/** Send a connection request to an email. Returns { status } or { error }.
 *  status: 'requested' | 'accepted' | 'already' | 'self' | 'invited' | 'invite_failed'.
 *  'invited' = no account yet, so an email invite was sent + a pending connection
 *  created; 'invite_failed' = the invite email couldn't be sent (SMTP not set up). */
export async function requestConnection(email) {
  const e = String(email || '').trim();
  if (!e) return { error: 'Enter an email address.' };
  const { data, error } = await supabase.functions.invoke('request-connection', { body: { email: e } });
  if (error) {
    // Surface the function's JSON error body when present.
    let msg = error.message || 'Request failed';
    try {
      const ctx = error.context && (await error.context.json());
      if (ctx?.error) msg = ctx.error;
    } catch (_) { /* keep msg */ }
    return { error: msg };
  }
  return { status: data?.status };
}

/** All of the caller's connection rows, partitioned. RLS returns only rows where
 *  the caller is a participant. Returns { accepted, pendingIn, pendingOut }. */
export async function listConnections() {
  const session = await getSession();
  const uid = session?.user?.id;
  if (!uid) return { accepted: [], pendingIn: [], pendingOut: [] };
  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return { accepted: [], pendingIn: [], pendingOut: [], error: error.message };

  const accepted = [];
  const pendingIn = []; // someone requested ME — I accept/decline
  const pendingOut = []; // I requested someone — awaiting them
  for (const c of data || []) {
    const iAmRequester = c.requester_id === uid;
    const other = iAmRequester
      ? { id: c.addressee_id, name: c.addressee_name, email: c.addressee_email }
      : { id: c.requester_id, name: c.requester_name, email: c.requester_email };
    const item = { id: c.id, other, status: c.status, createdAt: c.created_at };
    if (c.status === 'accepted') accepted.push(item);
    else if (iAmRequester) pendingOut.push(item);
    else pendingIn.push(item);
  }
  return { accepted, pendingIn, pendingOut };
}

/** Accept an incoming request (RLS: only the addressee may do this). */
export async function acceptConnection(id) {
  const { error } = await supabase
    .from('connections')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { error: error.message };
  // Push the requester's device that you accepted (best-effort; web itself has no
  // native push, but the requester may be on mobile).
  try {
    await supabase.functions.invoke('notify-accept', { body: { connectionId: id } });
  } catch (_) {
    /* non-fatal */
  }
  return {};
}

/** Delete a connection row — used for decline (incoming), cancel (outgoing) and
 *  remove (accepted). RLS allows either participant to delete. */
export async function removeConnection(id) {
  const { error } = await supabase.from('connections').delete().eq('id', id);
  return error ? { error: error.message } : {};
}
export const declineConnection = removeConnection;

/** Count of incoming pending requests (for the nav badge). Cheap HEAD count. */
export async function pendingIncomingCount() {
  const session = await getSession();
  const uid = session?.user?.id;
  if (!uid) return 0;
  const { count, error } = await supabase
    .from('connections')
    .select('id', { count: 'exact', head: true })
    .eq('addressee_id', uid)
    .eq('status', 'pending');
  return error ? 0 : count || 0;
}
