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

const session = await guard(); // redirects + returns null when signed out

if (session) {
  mountAccountChip(session);
  document.documentElement.classList.remove('auth-pending');
  // Pending-connection badge on the Settings tab (non-blocking).
  mountPendingBadge();
}

/** Decorate the Settings nav tab with a small badge when connection requests are
 *  waiting. Lives here so every page gets it (mirrors mobile's Settings-tab badge). */
async function mountPendingBadge() {
  try {
    const n = await pendingIncomingCount();
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
