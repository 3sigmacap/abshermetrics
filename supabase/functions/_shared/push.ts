// Shared helper: send Expo push notifications via the Expo push API.
// Used by request-connection and notify-accept (both run with the service_role key,
// so they can read recipients' push_tokens). Best-effort — never throws to the caller.

export interface PushMsg {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Send one message to many Expo push tokens (chunked to Expo's 100/req limit). */
export async function sendExpoPush(tokens: string[], msg: PushMsg): Promise<void> {
  const valid = (tokens || []).filter(
    (t) => typeof t === 'string' && t.startsWith('ExponentPushToken'),
  );
  if (!valid.length) return;
  for (let i = 0; i < valid.length; i += 100) {
    const messages = valid.slice(i, i + 100).map((to) => ({
      to,
      title: msg.title,
      body: msg.body,
      sound: 'default',
      data: msg.data ?? {},
    }));
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(messages),
      });
    } catch (_) {
      /* best-effort: a push failure must never break the connection flow */
    }
  }
}

/** Read a user's Expo push tokens via a service-role client. */
// deno-lint-ignore no-explicit-any
export async function tokensForUser(admin: any, userId: string): Promise<string[]> {
  const { data } = await admin.from('push_tokens').select('token').eq('user_id', userId);
  return ((data ?? []) as { token: string }[]).map((r) => r.token).filter(Boolean);
}
