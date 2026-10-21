/* OpenHands "pause is always reachable" safety net. (2026-10-20)
   Marc: the PAUSE button is the last resort for a runaway agent. Canvas 1.26+ hides the whole agent-status
   area (⏸ / ▶) when the composer row is narrower than 360 px - every phone in portrait. patch-ui.py removes that
   limit in the bundle, but the bundle files are served `immutable, max-age=1y`, so a browser that already
   cached the old file never sees the fix. This script lives in index.html (no-store), so it always runs:
   while the open conversation is RUNNING and the app's own [data-testid="stop-button"] is not on screen, it adds
   a round ⏸ button in the composer's right-hand block (before the mic / send) that calls
   POST /api/conversations/{id}/interrupt - the same call the app makes (instant; /pause would wait for the reply). It removes itself as soon as the app's own
   button is there or the run ends. Also: on narrow screens the model pill is ellipsised so the row has room. */
(() => {
  if (window.__ohPauseGuard) return;
  window.__ohPauseGuard = true;

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const cid = () => (location.href.match(UUID) || [])[0] || null;
  const ID = 'oh-pause-guard';

  const css = document.createElement('style');
  css.textContent = `
    @media (max-width: 480px) {
      [data-testid="chat-input-llm-profile"], [data-testid="chat-input-llm-model"] {
        max-width: 34vw !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
    }
    #${ID} { width: 32px; height: 32px; flex: 0 0 auto; border-radius: 9999px; display: inline-flex; align-items: center;
      justify-content: center; border: 1px solid #d33; color: #d33; background: transparent; font-size: 14px; line-height: 1;
      cursor: pointer; padding: 0; }
    #${ID}:active { background: #d33; color: #fff; }
    #${ID}[disabled] { opacity: .5; cursor: default; }`;
  (document.head || document.documentElement).appendChild(css);

  /* Same backend resolution as mode-toggle.js (the active backend + its key). */
  function backend() {
    const def = { id: 'default-local', base: '', key: window.__AGENT_CANVAS_SESSION_API_KEY__ };
    try {
      let id = new URLSearchParams(location.search).get('backend');
      if (!id) {
        const raw = sessionStorage.getItem('openhands-active-backend') || localStorage.getItem('openhands-active-backend');
        id = raw ? JSON.parse(raw).backendId : null;
      }
      if (!id || id === 'default-local') return def;
      const list = JSON.parse(localStorage.getItem('openhands-backends') || '[]');
      const b = list.find((x) => x && x.id === id);
      if (b && b.kind === 'local' && b.host && b.apiKey)
        return { id: b.id, base: b.host.replace(/\/+$/, ''), key: b.apiKey };
    } catch (e) { /* page's own backend */ }
    return def;
  }
  async function api(path, opts) {
    const b = backend();
    if (!b.key) throw new Error('no session key');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(b.base + path, { ...opts, signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'X-Session-API-Key': b.key } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    } finally { clearTimeout(t); }
  }

  const remove = () => { const n = document.getElementById(ID); if (n) n.remove(); };
  function add(id) {
    if (document.getElementById(ID)) return;
    const send = document.querySelector('[data-testid="submit-button"]');
    const block = send && send.parentElement;   // the right-hand block (mic + send)
    if (!block) return;
    const btn = document.createElement('button');
    btn.id = ID; btn.type = 'button'; btn.textContent = '⏸'; btn.title = 'Pause the agent'; btn.setAttribute('aria-label', 'Pause the agent');
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      btn.disabled = true;
      try { await api('/api/conversations/' + id + '/interrupt', { method: 'POST' }); }   // what the app's own button calls: cancels the in-flight model call at once (/pause waits for it)
      catch (e) { btn.disabled = false; btn.title = 'pause failed: ' + e.message; }
    });
    block.insertBefore(btn, block.firstChild);
  }

  let busy = false;
  async function tick() {
    if (busy) return; busy = true;
    try {
      const id = cid();
      if (!id) return remove();
      if (document.querySelector('[data-testid="stop-button"]')) return remove();   // the app's own button is there
      const info = await api('/api/conversations/' + id);
      if (info.execution_status === 'running' && !document.querySelector('[data-testid="stop-button"]')) add(id);
      else remove();
    } catch (e) { /* offline / no key: leave the app alone */ }
    finally { busy = false; }
  }
  const start = () => setInterval(tick, 1500);
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
})();
