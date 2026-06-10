// empty-state.js — shared loading / empty / error UI for the web data pages.
//
// After awaiting its per-user loader, each data page calls ONE of:
//   showLoading(container)                     // optional, while data loads
//   renderEmpty(container, {bag, onSample})    // user has 0 shots (NORMAL for a new account)
//   renderError(container, message)            // a real load failure (network/RLS)
//
// `container` is the element whose innerHTML is replaced with the panel (the
// page's main content area). Distinguishing EMPTY (new user → onboarding) from
// ERROR (broken load) is deliberate — a 0-shot account is not an error.

let injected = false;
function ensureStyle() {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.textContent = `
  .am-state{max-width:560px;margin:8vh auto;padding:40px 30px;text-align:center;
    border:1px solid var(--line,#1d3327);border-radius:16px;background:#0b1410cc;
    font-family:'Barlow Condensed',sans-serif;}
  .am-state .em-mark{font-family:'Bebas Neue',sans-serif;font-size:30px;letter-spacing:2px;
    color:#0a120d;background:var(--accent,#d4ff4f);width:64px;height:64px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;margin:0 auto 18px;
    box-shadow:0 0 24px #d4ff4f55;}
  .am-state.err .em-mark{background:var(--bad,#ff9d9d);color:#1a0a0a;box-shadow:none;}
  .am-state h2{font-family:'Bebas Neue',sans-serif;font-size:34px;letter-spacing:1px;
    font-weight:400;color:var(--ink,#e8f3ec);margin-bottom:10px;}
  .am-state p{font-size:16px;color:var(--dim,#8aa596);font-weight:300;line-height:1.5;
    margin:0 auto 22px;max-width:420px;}
  .am-state .em-cta{font-family:'Bebas Neue',sans-serif;font-size:21px;letter-spacing:1.5px;
    color:#0a120d;background:var(--accent,#d4ff4f);border:none;border-radius:10px;
    padding:12px 26px;cursor:pointer;transition:.18s;}
  .am-state .em-cta:hover{filter:brightness(1.07);}
  .am-state .em-cta:disabled{opacity:.55;cursor:default;}
  .am-state .em-link{display:inline-block;margin-top:16px;font-family:'IBM Plex Mono',monospace;
    font-size:12px;letter-spacing:1px;color:var(--dim,#8aa596);text-transform:uppercase;}
  .am-state .em-link:hover{color:var(--accent,#d4ff4f);}
  .am-state .em-msg{font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--dim2,#5e7568);
    margin-top:14px;min-height:16px;word-break:break-word;}
  .am-spin{display:inline-block;width:34px;height:34px;border:3px solid #1d3327;
    border-top-color:var(--accent,#d4ff4f);border-radius:50%;animation:amsp .8s linear infinite;}
  @keyframes amsp{to{transform:rotate(360deg)}}`;
  document.head.appendChild(s);
}

export function showLoading(container, msg = 'Loading your data…') {
  if (!container) return;
  ensureStyle();
  container.innerHTML = `<div class="am-state"><div class="am-spin"></div><p style="margin-top:18px">${esc(msg)}</p></div>`;
}

export function renderEmpty(container, { bag = false, onSample } = {}) {
  if (!container) return;
  ensureStyle();
  const hint = bag
    ? 'Upload your launch-monitor CSV, or load the sample data to explore the app first.'
    : 'Upload a session CSV on the Raw Data page to get started.';
  container.innerHTML = `
    <div class="am-state">
      <div class="em-mark">αM</div>
      <h2>No shots yet</h2>
      <p>${hint}</p>
      ${bag ? '<button class="em-cta" id="amLoadSample" type="button">Load sample data</button><br>' : ''}
      <a class="em-link" href="raw-data.html">Upload a session CSV &rarr;</a>
    </div>`;
  if (bag && typeof onSample === 'function') {
    const btn = container.querySelector('#amLoadSample');
    const msg = document.createElement('div');
    msg.className = 'em-msg';
    btn.insertAdjacentElement('afterend', msg);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      msg.textContent = 'Loading sample data…';
      try {
        const res = await onSample();
        if (res && res.error) {
          msg.textContent = res.error;
          btn.disabled = false;
        } else {
          msg.textContent = 'Loaded — refreshing…';
          location.reload();
        }
      } catch (e) {
        msg.textContent = (e && e.message) || 'Could not load sample data.';
        btn.disabled = false;
      }
    });
  }
}

export function renderError(container, message) {
  if (!container) return;
  ensureStyle();
  container.innerHTML = `
    <div class="am-state err">
      <div class="em-mark">!</div>
      <h2>Couldn't load your data</h2>
      <p>Something went wrong reaching your account. Check your connection and try again.</p>
      <button class="em-cta" type="button" onclick="location.reload()">Retry</button>
      <div class="em-msg">${esc(message || '')}</div>
    </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
