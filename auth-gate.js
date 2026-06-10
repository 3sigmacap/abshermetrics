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

const session = await guard(); // redirects + returns null when signed out

if (session) {
  mountAccountChip(session);
  document.documentElement.classList.remove('auth-pending');
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

  // Settings link — shown on every page except settings.html itself.
  const onSettings = /(^|\/)settings\.html(\?|#|$)/.test(location.pathname + location.href);
  if (!onSettings) {
    const cog = document.createElement('a');
    cog.href = 'settings.html';
    cog.textContent = 'Settings';
    cog.className = 'am-acct-link';
    wrap.appendChild(cog);
  }

  const out = document.createElement('button');
  out.type = 'button';
  out.textContent = 'Sign out';
  out.addEventListener('click', () => signOut());
  wrap.appendChild(out);
  nav.appendChild(wrap);
}
