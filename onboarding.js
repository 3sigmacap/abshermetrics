// onboarding.js — one-time "first login" prompt for the AbsherMetrics web app.
//
// The "track my own game vs. follow another player" choice used to live on the
// signup form. It now happens the first time a user enters the app (any signup
// method, including Google/Apple). `profiles.onboarded` (boolean) gates it: a new
// account starts false; making the choice sets it true so the prompt never returns.
//
// Mounted by auth-gate.js after the session is confirmed. Faithful peer of the
// mobile OnboardingScreen.
import { supabase } from './auth.js';
import { requestFollow } from './follows.js';

/** Show the first-run prompt iff this account hasn't been onboarded yet. Best-effort:
 *  any error just skips the prompt (never blocks the app). */
export async function maybeShowOnboarding(session) {
  const uid = session?.user?.id;
  if (!uid) return;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('onboarded')
      .eq('id', uid)
      .maybeSingle();
    // If the column/row is missing or errors, don't nag — treat as done.
    if (error) return;
    if (data && data.onboarded) return;
  } catch (_) {
    return;
  }
  mountOverlay(uid);
}

async function finish(uid) {
  // Mark onboarded so the prompt never shows again. Upsert (not update) so it works
  // even if the profiles row somehow doesn't exist yet (RLS insert: auth.uid() = id).
  try {
    await supabase.from('profiles').upsert({ id: uid, onboarded: true }, { onConflict: 'id' });
  } catch (_) { /* best-effort */ }
}

function mountOverlay(uid) {
  if (document.getElementById('amOnboard')) return;

  const style = document.createElement('style');
  style.id = 'amOnboardStyle';
  style.textContent = `
    #amOnboard{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;
      padding:24px;background:#070d0af2;backdrop-filter:blur(3px);
      font-family:'Barlow Condensed',system-ui,sans-serif;color:#e8f3ec;}
    #amOnboard .ob-card{width:100%;max-width:440px;border:1px solid #1d3327;border-radius:16px;
      background:#0b1410;padding:30px 26px 28px;}
    #amOnboard h2{font-family:'Bebas Neue','Barlow Condensed',sans-serif;font-weight:400;font-size:30px;
      letter-spacing:1px;margin:0 0 6px;}
    #amOnboard h2 b{color:#d4ff4f;font-weight:400;}
    #amOnboard .ob-sub{font-family:'IBM Plex Mono',monospace;font-size:12px;line-height:1.6;color:#8aa596;margin:0 0 22px;}
    #amOnboard .ob-opt{display:flex;flex-direction:column;gap:12px;}
    #amOnboard .ob-choice{display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;
      border:1px solid #26432f;border-radius:12px;background:#081109;color:#e8f3ec;padding:15px 16px;cursor:pointer;transition:.16s;}
    #amOnboard .ob-choice:hover,#amOnboard .ob-choice.on{border-color:#d4ff4f;background:#0e1a14;}
    #amOnboard .ob-choice .t{font-family:'Bebas Neue','Barlow Condensed',sans-serif;font-size:20px;letter-spacing:.5px;}
    #amOnboard .ob-choice .d{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8aa596;line-height:1.5;}
    #amOnboard .ob-follow{margin-top:16px;display:none;}
    #amOnboard .ob-follow.show{display:block;}
    #amOnboard label{display:block;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:1px;
      text-transform:uppercase;color:#5e7568;margin:0 0 6px 2px;}
    #amOnboard input{width:100%;background:#081109;border:1px solid #26432f;border-radius:9px;color:#e8f3ec;
      font-family:'Barlow Condensed',sans-serif;font-size:17px;padding:12px 13px;}
    #amOnboard input:focus{outline:none;border-color:#d4ff4f;}
    #amOnboard .ob-go{width:100%;font-family:'Bebas Neue','Barlow Condensed',sans-serif;font-size:22px;letter-spacing:1.5px;
      color:#070d0a;background:#d4ff4f;border:none;border-radius:10px;padding:12px;cursor:pointer;margin-top:18px;transition:.16s;}
    #amOnboard .ob-go:hover{filter:brightness(1.07);}
    #amOnboard .ob-go:disabled{opacity:.5;cursor:default;}
    #amOnboard .ob-msg{margin-top:14px;min-height:16px;font-family:'IBM Plex Mono',monospace;font-size:12px;line-height:1.5;text-align:center;color:#7fd4ff;}
    #amOnboard .ob-msg.err{color:#ff9d9d;}
    #amOnboard .ob-skip{display:block;width:100%;text-align:center;margin-top:14px;background:none;border:none;cursor:pointer;
      font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.5px;color:#5e7568;}
    #amOnboard .ob-spin{display:inline-block;width:13px;height:13px;border:2px solid #0006;border-top-color:#070d0a;
      border-radius:50%;vertical-align:-2px;margin-right:7px;animation:obsp .7s linear infinite;}
    @keyframes obsp{to{transform:rotate(360deg)}}`;
  document.head.appendChild(style);

  const ov = document.createElement('div');
  ov.id = 'amOnboard';
  ov.innerHTML = `
    <div class="ob-card" role="dialog" aria-modal="true" aria-labelledby="obTitle">
      <h2 id="obTitle">Welcome to ABSHER<b>METRICS</b></h2>
      <p class="ob-sub">How do you want to use the app? You can change this anytime in Settings.</p>
      <div class="ob-opt">
        <button type="button" class="ob-choice on" data-choice="track">
          <span class="t">Track my game</span>
          <span class="d">Upload your launch-monitor data and analyze your own shots.</span>
        </button>
        <button type="button" class="ob-choice" data-choice="follow">
          <span class="t">Follow a player</span>
          <span class="d">Watch another player's account read-only — once they approve.</span>
        </button>
      </div>
      <div class="ob-follow" id="obFollow">
        <label for="obEmail">Player's email to follow</label>
        <input id="obEmail" type="email" autocomplete="off" inputmode="email" placeholder="player@example.com">
      </div>
      <button class="ob-go" id="obGo" type="button">Get started</button>
      <div class="ob-msg" id="obMsg"></div>
    </div>`;
  document.body.appendChild(ov);

  let choice = 'track';
  const go = ov.querySelector('#obGo');
  const followBox = ov.querySelector('#obFollow');
  const emailInput = ov.querySelector('#obEmail');
  const msg = ov.querySelector('#obMsg');
  const setMsg = (t, err) => { msg.textContent = t || ''; msg.className = 'ob-msg' + (err ? ' err' : ''); };

  ov.querySelectorAll('.ob-choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      choice = btn.getAttribute('data-choice');
      ov.querySelectorAll('.ob-choice').forEach((b) => b.classList.toggle('on', b === btn));
      followBox.classList.toggle('show', choice === 'follow');
      setMsg('');
      if (choice === 'follow') emailInput.focus();
    });
  });

  const close = () => { ov.remove(); style.remove(); };
  const busy = (on) => {
    go.disabled = on;
    go.innerHTML = on ? '<span class="ob-spin"></span>One sec…' : 'Get started';
  };

  go.addEventListener('click', async () => {
    setMsg('');
    if (choice === 'track') {
      busy(true);
      await finish(uid);
      close();
      return;
    }
    // follow
    const email = emailInput.value.trim();
    if (!email) { setMsg('Enter the player’s email — or pick “Track my game”.', true); emailInput.focus(); return; }
    busy(true);
    const { status, error } = await requestFollow(email);
    if (error) {
      setMsg('Couldn’t send the request: ' + error, true);
      busy(false);
      return;
    }
    if (status === 'not_found') {
      setMsg('No account uses that email yet. You can invite them later from Settings → Followers.', true);
      busy(false);
      return;
    }
    // requested / already / self → onboarding is done either way.
    await finish(uid);
    setMsg(status === 'self' ? 'That was your own email — taking you in…' : 'Request sent! They’ll get a prompt to approve.');
    setTimeout(close, 1300);
  });

  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
}
