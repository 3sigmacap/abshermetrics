// Supabase Edge Function: push the requester when their connection request is accepted.
//
// The accept itself is a direct client UPDATE (RLS: only the addressee may flip a
// pending row to accepted). This function is then called by the addressee's client to
// notify the requester. It re-verifies server-side (service_role) that the caller IS
// the addressee of that connection AND it is accepted — so a caller can only ever
// trigger a push for a connection they legitimately accepted (no arbitrary push spam).
//
// Input  : { connectionId: string }
// Returns: { ok: true } (always 200 on success; push delivery is best-effort)
//
// Deploy:  npx supabase functions deploy notify-accept
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
    const connectionId = String(body?.connectionId ?? '');
    if (!connectionId) return json({ error: 'connectionId required' }, 400);

    const admin = createClient(url, service);
    const { data: conn, error: cErr } = await admin
      .from('connections')
      .select('*')
      .eq('id', connectionId)
      .maybeSingle();
    if (cErr) return json({ error: cErr.message }, 500);

    // Only the addressee of an accepted connection may trigger the requester's push.
    if (!conn || conn.addressee_id !== user.id || conn.status !== 'accepted') {
      return json({ ok: false }); // not authorized to notify for this row — no-op
    }

    const accepterName =
      (conn.addressee_name as string) || (user.email || '').split('@')[0] || 'Your connection';
    await sendExpoPush(await tokensForUser(admin, conn.requester_id as string), {
      title: 'Connection accepted',
      body: `${accepterName} accepted your connection request.`,
      data: { type: 'connection_accepted' },
    });
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
