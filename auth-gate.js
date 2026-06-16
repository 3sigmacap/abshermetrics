// auth-gate.js — drop-in protection for every web page.
//
// Each protected page adds ONE line in <head>:
//     <script>document.documentElement.className+=' auth-pending'</script>
//     <style>html.auth-pending body{visibility:hidden}</style>
//     <script type="module" src="auth-gate.js"></script>
//
// This module: (1) redirects to login.html if signed out, (2) reveals the page,
// (3) mounts a small account chip (name + Sign out) into the existing .nav.
import { guard, signOut, displayNameOf } from './auth.js';
import { pendingIncomingCount } from './connections.js';
import { listFollows, pendingFollowCount } from './follows.js';
import { getViewedUserId, setViewedUserId, rawStoredViewedUser } from './view-context.js';

const session = await guard(); // redirects + returns null when signed out

if (session) {
  // Validate + mount the "viewing" switcher BEFORE revealing the page, so a stale
  // viewed-user is corrected before any data loads.
  await mountViewSwitcher(session);
  mountAccountChip(session);
  document.documentElement.classList.remove('auth-pending');
  // Pending request badge on the Settings tab (connections + follows; non-blocking).
  mountPendingBadge();
}

/** Spectator "view as" control: if you have approved follows, a chip in the nav lets
 *  you switch between "My data" and each player you follow. Viewing another shows a
 *  read-only banner. Also self-heals a stale stored viewed-user (e.g. follow revoked). */
async function mountViewSwitcher(session) {
  const me = session.user.id;
  let following = [];
  try { following = (await listFollows()).following || []; } catch (_) { /* ignore */ }

  // Self-heal: if the stored viewed-user is no longer an approved follow, reset to self.
  const stored = rawStoredViewedUser();
  if (stored && stored !== me && !following.some((f) => f.other.id === stored)) {
    await setViewedUserId(null);
  }
  if (!following.length) return; // nothing to spectate

  const viewed = await getViewedUserId();
  const viewingOther = viewed !== me;
  const current = following.find((f) => f.other.id === viewed);
  const label = (p) => (p?.name || (p?.email || '').split('@')[0] || 'Player');

  if (!document.getElementById('amViewStyle')) {
    const st = document.createElement('style');
    st.id = 'amViewStyle';
    st.textContent = `
      .am-view{display:flex;align-items:center;gap:8px;margin-left:14px;font-family:'IBM Plex Mono',monospace;}
      .am-view select{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.5px;color:var(--ink,#e8f3ec);
        background:#10201780;border:1px solid var(--line2,#26432f);border-radius:18px;padding:7px 10px;cursor:pointer;}
      .am-view select:focus{outline:none;border-color:var(--accent,#d4ff4f);}
      .am-view .eye{font-size:13px;}
      .am-viewbar{position:sticky;top:0;z-index:50;background:#1a1206;border-bottom:1px solid #3a2a0a;
        color:#ffce6b;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.5px;
        display:flex;align-items:center;justify-content:center;gap:14px;padding:8px 14px;}
      .am-viewbar b{color:#ffe1a0;}
      .am-viewbar button{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#1a1206;background:#ffce6b;
        border:none;border-radius:14px;padding:5px 11px;cursor:pointer;font-weight:600;}
      html.am-readonly .am-writes{display:none !important;}`;
    document.head.appendChild(st);
  }

  // Read-only flag + banner when spectating someone else.
  if (viewingOther) {
    document.documentElement.classList.add('am-readonly');
    const bar = document.createElement('div');
    bar.className = 'am-viewbar';
    bar.innerHTML = `<span>👁 Viewing <b>${escapeHtmlLite(label(current?.other))}</b>'s account — read-only</span>`;
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'Back to My data';
    back.addEventListener('click', async () => { await setViewedUserId(null); location.reload(); });
    bar.appendChild(back);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  // The switcher in the nav.
  const nav = document.querySelector('.nav');
  if (nav) {
    const wrap = document.createElement('div');
    wrap.className = 'am-view';
    const sel = document.createElement('select');
    sel.innerHTML =
      `<option value="${me}"${!viewingOther ? ' selected' : ''}>👁 My data</option>` +
      following
        .map((f) => `<option value="${escapeHtmlLite(f.other.id)}"${f.other.id === viewed ? ' selected' : ''}>👁 ${escapeHtmlLite(label(f.other))}</option>`)
        .join('');
    sel.addEventListener('change', async () => { await setViewedUserId(sel.value); location.reload(); });
    wrap.appendChild(sel);
    nav.appendChild(wrap);
  }
}

function escapeHtmlLite(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Decorate the Settings nav tab with a small badge when connection requests are
 *  waiting. Lives here so every page gets it (mirrors mobile's Settings-tab badge). */
async function mountPendingBadge() {
  try {
    const [conn, foll] = await Promise.all([pendingIncomingCount(), pendingFollowCount()]);
    const n = (conn || 0) + (foll || 0);
    if (!n) return;
    const link = document.querySelector('.nav a.tab[href="settings.html"]');
    if (!link || link.querySelector('.am-badge')) return;
    if (!document.getElementById('amBadgeStyle')) {
      const st = document.createElement('style');
      st.id = 'amBadgeStyle';
      st.textContent = `
        .nav a.tab{position:relative;}
        .am-badge{display:inline-flex;align-items:center;justify-content:center;
          min-width:16px;height:16px;padding:0 4px;margin-left:6px;border-radius:9px;
          background:var(--accent,#d4ff4f);color:#0a120d;font-family:'IBM Plex Mono',monospace;
          font-size:10px;font-weight:600;line-height:1;vertical-align:middle;}`;
      document.head.appendChild(st);
    }
    const badge = document.createElement('span');
    badge.className = 'am-badge';
    badge.textContent = String(n);
    link.appendChild(badge);
  } catch (_) { /* badge is best-effort; never block the page */ }
}

function mountAccountChip(session) {
  if (document.getElementById('amAcctStyle')) return;

  const style = document.createElement('style');
  style.id = 'amAcctStyle';
  style.textContent = `
    .am-acct{display:flex;align-items:center;gap:10px;margin-left:14px;
      font-family:'IBM Plex Mono',monospace;}
    .am-acct .who{font-size:11px;letter-spacing:.5px;color:var(--dim,#8aa596);
      text-transform:uppercase;max-width:140px;overflow:hidden;text-overflow:ellipsis;
      white-space:nowrap;}
    .am-acct .who b{color:var(--accent,#d4ff4f);font-weight:500;}
    .am-acct button,.am-acct .am-acct-link{font-family:'IBM Plex Mono',monospace;font-size:11px;
      letter-spacing:1px;text-transform:uppercase;color:var(--dim,#8aa596);
      background:transparent;border:1px solid var(--line2,#26432f);border-radius:20px;
      padding:7px 13px;cursor:pointer;transition:.18s;text-decoration:none;display:inline-block;}
    .am-acct button:hover,.am-acct .am-acct-link:hover{color:var(--accent,#d4ff4f);border-color:var(--accent,#d4ff4f);}
    @media(max-width:760px){
      .am-acct{margin-left:auto;}
      .am-acct .who{display:none;}
    }`;
  document.head.appendChild(style);

  const nav = document.querySelector('.nav');
  if (!nav) return;
  const name = displayNameOf(session);
  const wrap = document.createElement('div');
  wrap.className = 'am-acct';
  const who = document.createElement('span');
  who.className = 'who';
  who.innerHTML = 'Signed in <b></b>';
  who.querySelector('b').textContent = name;
  wrap.appendChild(who);

  // (Settings is a first-class nav tab now — see each page's .nav — so the chip
  // only carries the signed-in name + Sign out, matching mobile where Sign out
  // lives in the Settings screen.)
  const out = document.createElement('button');
  out.type = 'button';
  out.textContent = 'Sign out';
  out.addEventListener('click', () => signOut());
  wrap.appendChild(out);
  nav.appendChild(wrap);
}
