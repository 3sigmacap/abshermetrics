// Supabase Edge Function: when a user uploads a NEW range session, notify everyone
// who follows them (approved) or is connected to them (accepted) — via Expo push AND
// email. Called by the client (web uploadCsvFiles / mobile importCsvText) right after
// a successful import. Runs with the service_role key so it can read other users'
// push_tokens, profiles (prefs), and emails — the caller can only ever trigger this
// for THEIR OWN session.
//
// Input  : { sessionId: string }
// Returns: { ok: true, recipients, pushed, emailed }  or  { ok: true, skipped: '…' }
//
// Idempotent + abuse-resistant:
//  - Atomically CLAIMS the session (sets notified_at where it was null + user_id matches),
//    so each session notifies at most once and you can't notify someone else's session.
//  - Skips sessions older than 24h (so a replayed/old id never blasts notifications).
//  - Soft per-uploader hourly cap (RATE_CAP) so one account can't spam its followers.
//  - Per-recipient opt-out via profiles.prefs.uploadAlerts === false.
//  - Push + email are best-effort and never throw to the caller.
//
// Deploy: npx supabase functions deploy notify-new-session
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendExpoPush } from '../_shared/push.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RATE_CAP = 20; // max sessions one uploader can notify per rolling hour
const MAX_RECIPIENTS = 500; // absolute backstop on fan-out per session
const FROM = 'AbsherMetrics <no-reply@abshermetrics.com>';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
type Admin = any;

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function renderEmail(uploaderName: string, label: string, site: string) {
  const subject = `${uploaderName} uploaded a new range session`;
  const safeName = esc(uploaderName);
  const safeLabel = esc(label);
  const html = `<!doctype html><html><body style="margin:0;background:#070d0a;font-family:Arial,Helvetica,sans-serif;color:#e8f3ec;padding:24px">
    <div style="max-width:520px;margin:0 auto;border:1px solid #1d3327;border-radius:14px;background:#0b1410;padding:28px">
      <div style="font-size:22px;font-weight:bold;letter-spacing:1px;margin-bottom:14px">ABSHER<span style="color:#d4ff4f">METRICS</span></div>
      <p style="font-size:16px;line-height:1.5;margin:0 0 8px">
        <strong style="color:#d4ff4f">${safeName}</strong> just uploaded a new range session.
      </p>
      <p style="font-size:13px;color:#8aa596;margin:0 0 22px">${safeLabel}</p>
      <a href="${esc(site)}" style="display:inline-block;background:#d4ff4f;color:#070d0a;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:9px;font-size:15px">Open AbsherMetrics</a>
      <p style="font-size:11px;color:#5e7568;margin:24px 0 0;line-height:1.5">
        You're getting this because you follow or are connected to ${safeName}.
        Turn these off anytime in Settings → New-session alerts.
      </p>
    </div></body></html>`;
  const text = `${uploaderName} just uploaded a new range session (${label}).\nOpen AbsherMetrics: ${site}\n\nYou're getting this because you follow or are connected to ${uploaderName}. Turn these off in Settings → New-session alerts.`;
  return { subject, html, text };
}

/** Email many recipients via Resend's BATCH endpoint (≤100 messages/request), one
 *  message per recipient so addresses are never exposed to each other. Best-effort —
 *  returns the count accepted; never throws. Batched (not a serial loop) so a large
 *  fan-out can't blow the function's wall-time. */
async function sendResendBatch(
  key: string,
  recipients: string[],
  uploaderName: string,
  label: string,
  site: string,
): Promise<number> {
  const { subject, html, text } = renderEmail(uploaderName, label, site);
  let sent = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const batch = recipients.slice(i, i + 100).map((to) => ({ from: FROM, to: [to], subject, html, text }));
    try {
      const r = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        sent += Array.isArray(j?.data) ? j.data.length : batch.length;
      }
    } catch (_) {
      /* best-effort: an email failure must never break the import flow */
    }
  }
  return sent;
}

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
    const sessionId = String(body?.sessionId ?? '');
    if (!sessionId) return json({ error: 'sessionId required' }, 400);
    // A malformed id would make the uuid column query throw a 500; treat it as a clean
    // no-op (consistent with the other skip paths). Real clients always pass a real uuid.
    if (!UUID_RE.test(sessionId)) return json({ ok: true, skipped: 'bad_id' });

    const admin: Admin = createClient(url, service);
    const uploader = user.id;
    const nowISO = new Date().toISOString();

    // Atomic claim: set notified_at ONLY if it's still null AND the session is the
    // caller's. This single statement enforces ownership + once-only in one shot — a
    // caller can't notify someone else's session, and a replay/double-invoke gets 0 rows.
    const { data: claimed, error: claimErr } = await admin
      .from('sessions')
      .update({ notified_at: nowISO })
      .eq('id', sessionId)
      .eq('user_id', uploader)
      .is('notified_at', null)
      .select('id, label, created_at')
      .maybeSingle();
    if (claimErr) return json({ error: claimErr.message }, 500);
    if (!claimed) return json({ ok: true, skipped: 'already_or_not_owner' });

    // Don't blast notifications for an old session (e.g. a replayed id for data that
    // predates this feature). The claim above already prevents re-firing.
    if (Date.parse(claimed.created_at as string) < Date.now() - 24 * 60 * 60 * 1000) {
      return json({ ok: true, skipped: 'stale' });
    }

    // Soft hourly cap (counts the row we just claimed). Protects recipients from spam.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await admin
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uploader)
      .gte('notified_at', hourAgo);
    if ((recentCount ?? 0) > RATE_CAP) {
      // Roll back the claim so this session isn't permanently marked notified for a row
      // nobody was actually told about — and so rate-limited rows don't count toward the
      // cap going forward. (Clients fire once, so in practice it still won't re-notify.)
      await admin.from('sessions').update({ notified_at: null }).eq('id', sessionId).eq('user_id', uploader);
      return json({ ok: true, skipped: 'rate_limited' });
    }

    // ── Recipients: approved followers + accepted connections (either direction) ──
    const [{ data: follows }, { data: conns }] = await Promise.all([
      admin.from('follows').select('follower_id').eq('followed_id', uploader).eq('status', 'approved'),
      admin
        .from('connections')
        .select('requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${uploader},addressee_id.eq.${uploader}`),
    ]);
    const ids = new Set<string>();
    for (const f of follows ?? []) if (f.follower_id) ids.add(f.follower_id as string);
    for (const c of conns ?? []) {
      const other = c.requester_id === uploader ? c.addressee_id : c.requester_id;
      if (other) ids.add(other as string);
    }
    ids.delete(uploader); // never notify yourself
    const recipientIds = [...ids].slice(0, MAX_RECIPIENTS); // backstop on fan-out
    if (!recipientIds.length) return json({ ok: true, recipients: 0 });

    // Per-recipient opt-out (prefs.uploadAlerts === false). Default = on.
    const { data: profs } = await admin.from('profiles').select('id, prefs').in('id', recipientIds);
    const muted = new Set(
      (profs ?? []).filter((p: { prefs?: { uploadAlerts?: boolean } }) => p?.prefs?.uploadAlerts === false).map((p: { id: string }) => p.id),
    );
    const targets = recipientIds.filter((id) => !muted.has(id));
    if (!targets.length) return json({ ok: true, recipients: 0, muted: muted.size });

    // Uploader's display name for the message.
    const { data: meProf } = await admin.from('profiles').select('display_name').eq('id', uploader).maybeSingle();
    // Deliberately NO email-local-part fallback — that would surface a piece of the
    // uploader's email in messages to followers/connections. Generic label instead.
    const uploaderName =
      (meProf?.display_name as string) ||
      (user.user_metadata?.display_name as string) ||
      'A player';
    const label = (claimed.label as string) || 'a new range session';

    // ── Push (one batched Expo send to all target devices) ──
    const { data: toks } = await admin.from('push_tokens').select('token').in('user_id', targets);
    const tokens = ((toks ?? []) as { token: string }[]).map((t) => t.token).filter(Boolean);
    await sendExpoPush(tokens, {
      title: 'New range session',
      body: `${uploaderName} just uploaded a new range session.`,
      data: { type: 'new_session', userId: uploader, sessionId },
    });

    // ── Email (Resend BATCH, one message per recipient so addresses aren't exposed) ──
    let emailed = 0;
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (resendKey) {
      const site = Deno.env.get('SITE_URL') || 'https://abshermetrics.com';
      const { data: emails } = await admin.rpc('emails_for_users', { p_ids: targets });
      const addrs = ((emails ?? []) as { id: string; email: string | null }[])
        .map((r) => r.email)
        .filter((e): e is string => !!e);
      emailed = await sendResendBatch(resendKey, addrs, uploaderName, label, site);
    }

    return json({ ok: true, recipients: targets.length, pushed: tokens.length, emailed });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
