/* OpenHands "🧠 Thinking" list in the composer's "+" menu — Low / Medium / High, for every model. (2026-10-19)
   Injected into index.html at container start by patch-ui.py, like mode-toggle.js / edit-last.js.

   The canvas ties reasoning effort to a saved LLM profile (Settings) only. This adds a per-conversation choice:
   - in a conversation: POST /api/conversations/{id}/switch_llm with the conversation's own LLM (GET .../{id} ->
     agent.llm) and the new reasoning_effort, from the next model call on. switch_llm keeps an LLM already registered
     under the same usage_id ("first write wins"), so each choice gets its own usage_id `effort:<level>:<model>`.
     Picking another model in the composer's dropdown loads that profile's own effort (Medium by default).
   - on the home page: the choice is remembered in this browser (localStorage `oh-effort-new`) and written into the
     NEW conversation's create request (agent_settings.llm.reasoning_effort), so it applies from the first message.
   The effort only reaches our coders thanks to host patch 3 (host/tools/oh_host_patches.py): extra_body, plus the
   DeepSeek V4 mapping low/medium/high -> medium/high/max (V4.1 + Qwen as is), the same table as llm-router's auto. */
(() => {
  if (window.__ohEffortMenu) return;
  window.__ohEffortMenu = true;

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const cid = () => (location.href.match(UUID) || [])[0] || null;
  const HEAD_ID = 'oh-effort-button';
  const LEVELS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
  const NEW_KEY = 'oh-effort-new';
  const name = (v) => (LEVELS.find((l) => l[0] === v) || [v, v ? v[0].toUpperCase() + v.slice(1) : '…'])[1];
  const lsGet = () => { try { return localStorage.getItem(NEW_KEY); } catch (e) { return null; } };
  const lsSet = (v) => { try { localStorage.setItem(NEW_KEY, v); } catch (e) { /* ignore */ } };

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
  async function api(b, path, opts) {
    if (!b.key) throw new Error('no session key');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(b.base + path, { ...opts, signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'X-Session-API-Key': b.key, ...(opts || {}).headers } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    } catch (e) {
      throw new Error(ctl.signal.aborted ? 'timeout (10 s)' : e.message);
    } finally { clearTimeout(t); }
  }

  async function convLlm(b, id) {
    const info = await api(b, '/api/conversations/' + id);
    const llm = info.agent && info.agent.llm;
    if (!llm || !llm.model) throw new Error('no model on this conversation');
    return llm;
  }
  async function current(b) {
    const id = cid();
    if (id) return (await convLlm(b, id)).reasoning_effort || null;
    const pending = lsGet();
    if (pending) return pending;
    const s = await api(b, '/api/settings');
    return (s.agent_settings && s.agent_settings.llm && s.agent_settings.llm.reasoning_effort) || null;
  }
  async function apply(b, level) {
    const id = cid();
    if (!id) { lsSet(level); return; }
    const llm = await convLlm(b, id);
    const next = { ...llm, reasoning_effort: level, usage_id: 'effort:' + level + ':' + llm.model };
    if (!next.api_key) next.api_key = 'local';   // GET hides the key; our coders take any
    await api(b, '/api/conversations/' + id + '/switch_llm', { method: 'POST', body: JSON.stringify({ llm: next }) });
  }

  /* Home page: put the remembered choice into the NEW conversation's create request. */
  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      const level = lsGet();
      if (level && init && (init.method || 'GET').toUpperCase() === 'POST' && typeof init.body === 'string'
          && /\/api\/conversations(\?|$)/.test(url || '')) {
        const body = JSON.parse(init.body);
        const llm = body && body.agent_settings && body.agent_settings.llm;
        if (llm) { llm.reasoning_effort = level; init = { ...init, body: JSON.stringify(body) }; }
      }
    } catch (e) { /* never break the app's own request */ }
    return origFetch(input, init);
  };

  function setLabel(item, text) {
    const svg = item.querySelector('svg'); if (svg) svg.remove();
    const nodes = [...item.querySelectorAll('*')].filter((n) => n.children.length === 0 && n.textContent.trim());
    const target = nodes[nodes.length - 1];
    if (target) target.textContent = text; else item.textContent = text;
  }
  function closeMenu() {
    const plus = document.querySelector('[data-testid="chat-plus-button"]');
    if (plus && plus.getAttribute('aria-expanded') === 'true') plus.click();
  }
  const headText = (v) => '🧠 Thinking' + (cid() ? '' : ' (new chats)') + ': ' + name(v) + '  ▾';

  function inject(menu) {
    if (menu.querySelector('[data-testid="' + HEAD_ID + '"]')) return;
    const tpl = menu.querySelector('[data-testid="show-skills-button"]') || menu.querySelector('[data-testid$="-button"]');
    if (!tpl) return;
    const clone = (tid) => {
      const n = tpl.cloneNode(true);
      n.setAttribute('data-testid', tid); n.removeAttribute('disabled'); n.removeAttribute('aria-disabled');
      return n;
    };
    const b = backend();
    let value = null, open = false, busy = false;
    const head = clone(HEAD_ID);
    setLabel(head, '🧠 Thinking: …');
    const rows = LEVELS.map(([v]) => {
      const row = clone('oh-effort-' + v);
      row.style.display = 'none';
      row.style.paddingLeft = '2.25rem';
      row.addEventListener('click', async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (busy) return; busy = true;
        setLabel(head, '🧠 Thinking: … switching');
        try {
          await apply(b, v); value = v; open = false; paint();
          setTimeout(closeMenu, 350);
        } catch (e) { setLabel(head, '🧠 Thinking: failed (' + e.message + ')'); }
        finally { busy = false; }
      });
      return [v, row];
    });
    function paint() {
      setLabel(head, headText(value));
      for (const [v, row] of rows) {
        setLabel(row, (v === value ? '✓ ' : '   ') + name(v));
        row.style.display = open ? '' : 'none';
      }
    }
    head.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (busy) return;
      open = !open; paint();
    });
    // after our other items (ASK/AUTO, Edit my last message), else first
    const anchor = menu.querySelector('[data-testid="oh-edit-last-button"]') || menu.querySelector('[data-testid="oh-mode-toggle-button"]');
    let at = anchor ? anchor.nextSibling : menu.firstChild;
    menu.insertBefore(head, at);
    for (const [, row] of rows) menu.insertBefore(row, at);
    paint();
    current(b).then((v) => { value = v; if (!busy) paint(); }).catch(() => {});
  }

  const scan = (root) => {
    if (!(root instanceof Element)) return;
    if (root.matches && root.matches('[data-testid="tools-context-menu"]')) inject(root);
    root.querySelectorAll && root.querySelectorAll('[data-testid="tools-context-menu"]').forEach(inject);
  };
  const start = () => {
    new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) scan(n); })
      .observe(document.body, { childList: true, subtree: true });
    scan(document.body);
  };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
})();
