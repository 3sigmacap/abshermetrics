// Supabase Edge Function: request to FOLLOW another player by email.
//
// A follow lets the caller (follower) VIEW the target's (followed) full account
// read-only once the target APPROVES. The browser/app can't resolve an email -> user
// id under RLS, so this runs with the service_role key to look it up and create a
// PENDING follow (follower = caller, followed = found). Only EXISTING users can be
// followed (you follow someone who is already tracking).
//
// Input  : { email: string }
// Returns: { status: 'requested' | 'already' | 'self' | 'not_found' }
//   requested  — a pending follow was created (target must approve)
//   already    — you already follow / have a pending follow for that user
//   self       — that email is your own account
//   not_found  — no AbsherMetrics account uses that email
//
// Deploy:  npx supabase functions deploy follow-request
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendExpoPush, tokensForUser } from '../_shared/push.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const target = String(body?.email ?? '').trim().toLowerCase();
    if (!target) return json({ error: 'Email required' }, 400);

    const admin = createClient(url, service);

    // Caller (follower) display info — stored on the row so the followed user can
    // see WHO is asking to follow them without reading the caller's profile.
    const fmeta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const followerName =
      (fmeta.display_name as string) ||
      (fmeta.full_name as string) ||
      (fmeta.name as string) ||
      null;
    const followerEmail = user.email ?? null;
    const callerName = followerName || (followerEmail || '').split('@')[0] || 'Someone';

    // Resolve email -> user id (service-role RPC). Only existing users can be followed.
    const { data: foundId, error: rpcErr } = await admin.rpc('user_id_by_email', { p_email: target });
    if (rpcErr) return json({ error: rpcErr.message }, 500);
    if (!foundId) return json({ status: 'not_found' });
    if (foundId === user.id) return json({ status: 'self' });

    // Already following / pending?
    const { data: existing, error: exErr } = await admin
      .from('follows')
      .select('id,status')
      .eq('follower_id', user.id)
      .eq('followed_id', foundId)
      .maybeSingle();
    if (exErr) return json({ error: exErr.message }, 500);
    if (existing) return json({ status: 'already' });

    // Target display info (for the follower's "Following" list).
    const { data: followedProfile } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', foundId)
      .maybeSingle();

    const { error: insErr } = await admin.from('follows').insert({
      follower_id: user.id,
      followed_id: foundId,
      status: 'pending',
      follower_name: followerName,
      follower_email: followerEmail,
      followed_name: (followedProfile?.display_name as string) ?? null,
      followed_email: target,
    });
    if (insErr) return json({ error: insErr.message }, 500);

    // Notify the followed user that someone wants to follow them.
    await sendExpoPush(await tokensForUser(admin, foundId), {
      title: 'New follow request',
      body: `${callerName} wants to follow your shots on AbsherMetrics.`,
      data: { type: 'follow_request' },
    });

    return json({ status: 'requested' });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
