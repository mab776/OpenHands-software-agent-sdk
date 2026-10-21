/* OpenHands ASK/AUTO toggle — an item in the composer's "+" menu (data-testid="chat-plus-button"),
   injected into index.html at container start by patch-ui.py.

   v3: NO floating element (v1 covered the composer; v2's "draggable circle" was still a lock pad
   sitting on the UI). The menu container is [data-testid="tools-context-menu"], mounted inline next
   to the + button (not a portal), so a MutationObserver on <body> sees it appear. The item is a
   cloneNode of the app's own "Show skills" entry ([data-testid="show-skills-button"]), so it
   inherits the exact styling; a clone carries no React handlers, so we attach our own.
   v4: also on the home page (flips the default for NEW conversations).
   v5: BACKEND-AWARE. Agent Canvas can talk to several agent-servers ("Manage Backends"); the browser
   calls the active one DIRECTLY (host + apiKey from localStorage `openhands-backends`, active id from
   `openhands-active-backend` / the `?backend=` URL param). v4 always hit the page origin = the
   container backend, so the item lied for conversations on the host-native backend (:7300).
   Now every call goes to the active backend with ITS key, and the label names it when it isn't the
   default one.

   v6 (2026-09-22): hard 10 s timeout on every call (the phone showed "… switching" forever while the
   agent-server was busy retrying a dead LLM), re-read on every menu open, and a 90 s "trust my own
   POST" window because GET /api/conversations/{id} serves confirmation_policy from base_state.json,
   which is only rewritten on the next state save (the taps HAD landed — the server log proved it).

   Flips the CURRENT conversation's confirmation policy (server-side, per conversation) and reuses
   keys the page already holds — nothing secret lives in this file. */
(() => {
  if (window.__ohModeMenu) return;
  window.__ohModeMenu = true;

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const cid = () => (location.href.match(UUID) || [])[0] || null;
  const ASK = { kind: 'ConfirmRisky', threshold: 'HIGH', confirm_unknown: true };
  const AUTO = { kind: 'NeverConfirm' };
  const ITEM_ID = 'oh-mode-toggle-button';
  const LABEL = {
    ask:  '\u{1F512} ASK mode — tap for AUTO',
    auto: '⚡ AUTO mode — tap for ASK',
    busy: '… switching',
    unknown: '\u{1F512}/⚡ confirmation mode',
    home_ask:  '\u{1F512} New chats start in ASK — tap for AUTO',
    home_auto: '⚡ New chats start in AUTO — tap for ASK',
  };
  let current = null;           // 'ask' | 'auto' | null
  let currentFor = null;        // "<backend id>@<conversation id>" the cached state belongs to

  /* Active backend = the one the app itself is using (same storage keys as the frontend). */
  function backend() {
    const def = { id: 'default-local', name: 'Local', base: '', key: window.__AGENT_CANVAS_SESSION_API_KEY__ };
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
        return { id: b.id, name: b.name || b.host, base: b.host.replace(/\/+$/, ''), key: b.apiKey };
    } catch (e) { /* fall through to the page's own backend */ }
    return def;
  }
  const tag = (b, text) => (b.id === 'default-local' ? text : text + ' · ' + b.name);

  /* v6: every call has a hard timeout so the item can never sit on "… switching" (seen on the phone
     2026-09-22 while the coder was down and the agent-server was busy retrying the LLM). */
  async function api(b, path, opts) {
    if (!b.key) throw new Error('no session key');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    try {
      return await fetch(b.base + path, { ...opts, signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'X-Session-API-Key': b.key, ...(opts || {}).headers } });
    } catch (e) {
      throw new Error(ctl.signal.aborted ? 'timeout (10 s)' : e.message);
    } finally { clearTimeout(t); }
  }
  let flippedAt = 0;             // when we last POSTed a policy (the POST is authoritative for a while)
  async function load(b, id) {
    const r = await api(b, '/api/conversations/' + id);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const info = await r.json();
    const srv = info.confirmation_policy && info.confirmation_policy.kind === 'NeverConfirm' ? 'auto' : 'ask';
    const key = b.id + '@' + id;
    // The server answers GET from base_state.json, rewritten only on the next state save, so for a
    // short while after a POST it can still report the OLD policy. Trust our own POST meanwhile.
    if (currentFor === key && current && current !== srv && Date.now() - flippedAt < 90000) return current;
    current = srv; currentFor = key;
    return current;
  }
  async function flip(b, id) {
    const next = current === 'auto' ? 'ask' : 'auto';
    const r = await api(b, '/api/conversations/' + id + '/confirmation_policy',
      { method: 'POST', body: JSON.stringify({ policy: next === 'auto' ? AUTO : ASK }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    current = next; currentFor = b.id + '@' + id; flippedAt = Date.now();
    return next;
  }

  /* Home page (no conversation in the URL): the item shows and flips the DEFAULT for new
     conversations = conversation_settings.confirmation_mode (Settings > Verification) — on the
     ACTIVE backend (each backend keeps its own settings). */
  async function loadDefault(b) {
    const r = await api(b, '/api/settings');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    return d.conversation_settings && d.conversation_settings.confirmation_mode ? 'ask' : 'auto';
  }
  async function flipDefault(b, mode) {
    const next = mode === 'auto' ? 'ask' : 'auto';
    const r = await api(b, '/api/settings', { method: 'PATCH',
      body: JSON.stringify({ conversation_settings_diff: { confirmation_mode: next === 'ask', security_analyzer: 'llm' } }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return next;
  }

  /* The item component renders an icon element followed by a text node/span; set the text of the
     LAST non-empty text-bearing descendant and drop the SVG so the emoji is the icon. */
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
  function makeItem(menu) {
    const tpl = menu.querySelector('[data-testid="show-skills-button"]')
             || menu.querySelector('[data-testid$="-button"]');
    if (!tpl) return null;
    const item = tpl.cloneNode(true);
    item.setAttribute('data-testid', ITEM_ID);
    item.removeAttribute('disabled');
    item.removeAttribute('aria-disabled');
    return item;
  }

  function inject(menu) {
    if (menu.querySelector('[data-testid="' + ITEM_ID + '"]')) return;
    const id = cid();
    if (!id) return injectHome(menu);
    const item = makeItem(menu); if (!item) return;
    const b = backend();
    const fresh = currentFor === b.id + '@' + id && current;
    setLabel(item, fresh ? tag(b, LABEL[current]) : LABEL.unknown);
    item.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      setLabel(item, LABEL.busy);
      try { const m = await flip(b, id); setLabel(item, tag(b, LABEL[m])); }
      catch (e) { setLabel(item, 'failed: ' + e.message); return; }
      setTimeout(closeMenu, 350);
    });
    // First entry in the menu, separated from the app's own items.
    menu.insertBefore(item, menu.firstChild);
    // v6: ALWAYS re-read on open (the cached label is only the placeholder). The server answers
    // GET from base_state.json, which is rewritten on the next state save, so a read right after a
    // POST can lag by one event — re-reading on every open makes the label self-correct.
    load(b, id).then((m) => { if (!item.textContent.startsWith(LABEL.busy)) setLabel(item, tag(b, LABEL[m])); }).catch(() => {});
  }

  function injectHome(menu) {
    const item = makeItem(menu); if (!item) return;
    const b = backend();
    let mode = null;
    setLabel(item, LABEL.unknown);
    loadDefault(b).then((m) => { mode = m; setLabel(item, tag(b, LABEL['home_' + m])); }).catch(() => {});
    item.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (!mode) return;
      setLabel(item, LABEL.busy);
      try { mode = await flipDefault(b, mode); setLabel(item, tag(b, LABEL['home_' + mode])); }
      catch (e) { setLabel(item, 'failed: ' + e.message); return; }
      setTimeout(closeMenu, 350);
    });
    menu.insertBefore(item, menu.firstChild);
  }

  const scan = (root) => {
    if (!(root instanceof Element)) return;
    if (root.matches && root.matches('[data-testid="tools-context-menu"]')) inject(root);
    root.querySelectorAll && root.querySelectorAll('[data-testid="tools-context-menu"]').forEach(inject);
  };
  const start = () => {
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) scan(n);
    }).observe(document.body, { childList: true, subtree: true });
    scan(document.body);
    // Warm the cache when a conversation is open so the label is right on first open.
    setInterval(() => {
      const id = cid(); if (!id) return;
      const b = backend();
      if (currentFor !== b.id + '@' + id) load(b, id).catch(() => {});
    }, 2000);
  };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
})();
