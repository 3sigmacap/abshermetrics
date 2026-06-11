// Supabase Edge Function: request a connection with another player by email.
//
// The browser/app can't look up auth.users by email (RLS), so this runs with the
// service_role key to resolve the email -> user id, then creates a PENDING
// connection (or auto-accepts if the other person already requested you).
//
// Input  : { email: string }
// Returns: { status: 'requested'|'accepted'|'already'|'self'|'invited'|'invite_failed'|'rate_limited' }
//   requested      — a pending request was created (existing user)
//   accepted       — the other person had already requested you, so it's now mutual
//   already        — a request/connection already exists between you two
//   self           — that email is your own account
//   invited        — no account yet → an email invite was sent + a pending connection
//                    created, so it's waiting for them when they join (Phase D)
//   invite_failed  — the invite email couldn't be sent (usually: SMTP not configured)
//   rate_limited   — caller hit the per-day email-invite cap (429)
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

    // Caller (requester) display info — used for the connection row, invite + push text.
    const requesterName = (user.user_metadata?.display_name as string) ?? null;
    const requesterEmail = user.email ?? null;
    const callerName = requesterName || (requesterEmail || '').split('@')[0] || 'Someone';

    // Resolve the email -> user id (service-role RPC).
    const { data: foundId, error: rpcErr } = await admin.rpc('user_id_by_email', { p_email: target });
    if (rpcErr) return json({ error: rpcErr.message }, 500);

    // ── Phase D ─ no AbsherMetrics account uses that email yet ──────────────────
    // Send an email invite (Supabase Auth) AND create a pending connection to the
    // freshly-invited user, so the request is already waiting for them the moment
    // they accept the invite and join. Re-inviting the same email is impossible to
    // double-send: once invited, the user EXISTS, so the next call resolves foundId
    // (→ the 'already' path below) instead of landing here again.
    if (!foundId) {
      // Rate limit: cap how many fresh email invites one account can send per day.
      // Each invite creates a real auth user + sends an email, so this blocks spam and
      // email-quota exhaustion. The invites table is the per-user audit log we count.
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: recentInvites } = await admin
        .from('invites')
        .select('id', { count: 'exact', head: true })
        .eq('inviter_id', user.id)
        .gte('created_at', dayAgo);
      const dailyCap = parseInt(Deno.env.get('MAX_INVITES_PER_DAY') || '25', 10);
      if ((recentInvites ?? 0) >= dailyCap) {
        return json({ status: 'rate_limited', error: 'Daily invite limit reached. Try again tomorrow.' }, 429);
      }

      const site = Deno.env.get('SITE_URL') || 'https://abshermetrics.com';
      const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(target, {
        data: { invited_by: user.id, invited_by_name: callerName },
        redirectTo: `${site}/welcome.html`,
      });
      if (invErr || !invited?.user) {
        // Couldn't send (most often: custom SMTP not configured yet). Keep the
        // client-facing error generic — don't echo the internal server message.
        console.error('inviteUserByEmail failed:', invErr?.message);
        return json({ status: 'invite_failed', error: 'Could not send the invite email right now.' });
      }
      // Audit record of the email invite (best-effort — log, but never block on it).
      const { error: auditErr } = await admin.from('invites').insert({ inviter_id: user.id, email: target });
      if (auditErr) console.warn('invites insert failed:', auditErr.message);
      // Pending connection so it's waiting for them on join. Tolerate a duplicate from
      // a race (unique-violation = Postgres error code 23505).
      const { error: insErr } = await admin.from('connections').insert({
        requester_id: user.id,
        addressee_id: invited.user.id,
        status: 'pending',
        requester_name: requesterName,
        requester_email: requesterEmail,
        addressee_name: null,
        addressee_email: target,
      });
      const isDup = insErr && (insErr.code === '23505' || /duplicate key/i.test(insErr.message ?? ''));
      if (insErr && !isDup) return json({ error: insErr.message }, 500);
      return json({ status: 'invited' });
    }

    if (foundId === user.id) return json({ status: 'self' });

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
