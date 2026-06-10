// Supabase Edge Function: request a connection with another player by email.
//
// The browser/app can't look up auth.users by email (RLS), so this runs with the
// service_role key to resolve the email -> user id, then creates a PENDING
// connection (or auto-accepts if the other person already requested you).
//
// Input  : { email: string }
// Returns: { status: 'requested' | 'accepted' | 'already' | 'self' | 'not_found' }
//   requested  — a pending request was created
//   accepted   — the other person had already requested you, so it's now mutual
//   already    — a request/connection already exists between you two
//   self       — that email is your own account
//   not_found  — no AbsherMetrics account uses that email yet (Phase D: send an invite)
//
// Deploy:  npx supabase functions deploy request-connection
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
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

    // Identify the caller from their JWT.
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

    // Resolve the email -> user id (service-role RPC).
    const { data: foundId, error: rpcErr } = await admin.rpc('user_id_by_email', { p_email: target });
    if (rpcErr) return json({ error: rpcErr.message }, 500);
    if (!foundId) return json({ status: 'not_found' }); // Phase D: create an invite here
    if (foundId === user.id) return json({ status: 'self' });

    // Caller (requester) display info — used for the connection row + push text.
    const requesterName = (user.user_metadata?.display_name as string) ?? null;
    const requesterEmail = user.email ?? null;
    const callerName = requesterName || (requesterEmail || '').split('@')[0] || 'Someone';

    // Existing connection in either direction?
    const { data: existing, error: exErr } = await admin
      .from('connections')
      .select('*')
      .or(
        `and(requester_id.eq.${user.id},addressee_id.eq.${foundId}),` +
          `and(requester_id.eq.${foundId},addressee_id.eq.${user.id})`,
      );
    if (exErr) return json({ error: exErr.message }, 500);
    const row = existing?.[0];

    if (row) {
      if (row.status === 'accepted') return json({ status: 'already' });
      // pending — if THEY already requested ME, accept it (now mutual).
      if (row.addressee_id === user.id) {
        const { error: upErr } = await admin
          .from('connections')
          .update({ status: 'accepted', responded_at: new Date().toISOString() })
          .eq('id', row.id);
        if (upErr) return json({ error: upErr.message }, 500);
        // Push the original requester that the caller accepted (now mutual).
        await sendExpoPush(await tokensForUser(admin, row.requester_id), {
          title: 'Connection accepted',
          body: `${callerName} accepted your connection request.`,
          data: { type: 'connection_accepted' },
        });
        return json({ status: 'accepted' });
      }
      return json({ status: 'already' }); // I already requested them
    }

    // New request — store display info so each side can show WHO without reading
    // the other's owner-only profiles row.
    const { data: addrProfile } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', foundId)
      .maybeSingle();

    const { error: insErr } = await admin.from('connections').insert({
      requester_id: user.id,
      addressee_id: foundId,
      status: 'pending',
      requester_name: requesterName,
      requester_email: requesterEmail,
      addressee_name: (addrProfile?.display_name as string) ?? null,
      addressee_email: target,
    });
    if (insErr) return json({ error: insErr.message }, 500);
    // Push the addressee about the incoming request.
    await sendExpoPush(await tokensForUser(admin, foundId), {
      title: 'New connection request',
      body: `${callerName} wants to connect on AbsherMetrics.`,
      data: { type: 'connection_request' },
    });
    return json({ status: 'requested' });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
