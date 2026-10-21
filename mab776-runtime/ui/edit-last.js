/* OpenHands "Edit my last message" IN PLACE — an item in the composer's "+" menu, next to the ASK/AUTO
   item (mode-toggle.js). Injected into index.html at container start by patch-ui.py. (2026-10-19)

   Why: the canvas only offers "Branch from here", which FORKS a new conversation (then Marc deleted the
   old one by hand). The agent-server can re-root a conversation in place instead:
   POST /api/conversations/{id}/navigate {event_id} moves HEAD; the agent then only sees that branch
   (the old message + its answers stay on disk, off the active branch).

   Click → (pause the agent if it is running) → find the LAST user message on the active branch →
   navigate HEAD to its parent → put its text back in the composer (the app's own saved draft,
   localStorage `conversation-state-<id>`.draftMessage) → reload the page. Edit, press Send.

   Needs the host backend patch 2 in host/tools/oh_host_patches.py (event search limited to the active
   branch); without it the edited-away message would still be listed on screen (the agent would not see it).
   Images attached to that message are not restored (text only). Files the agent already changed stay changed. */
(() => {
  if (window.__ohEditLast) return;
  window.__ohEditLast = true;

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const cid = () => (location.href.match(UUID) || [])[0] || null;
  const ITEM_ID = 'oh-edit-last-button';
  const LABEL = '✏️ Edit my last message';

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
    const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(b.base + path, { ...opts, signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'X-Session-API-Key': b.key, ...(opts || {}).headers } });
      if (!r.ok) throw new Error(path.split('/').pop().split('?')[0] + ': HTTP ' + r.status);
      return r.json();
    } catch (e) {
      throw new Error(ctl.signal.aborted ? 'timeout (15 s)' : e.message);
    } finally { clearTimeout(t); }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (ev) => ((ev.llm_message && ev.llm_message.content) || [])
    .filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');

  async function lastUserMessage(b, id) {
    // (the server's `kind` filter wants the full python class path, so filter the kind here)
    const q = 'sort_order=TIMESTAMP_DESC&source=user&limit=50';
    const page = await api(b, '/api/conversations/' + id + '/events/search?' + q);
    return (page.items || []).find((e) => e.kind === 'MessageEvent') || null;
  }
  /* Legacy events (before the event tree) have no parent_id: their parent is the previous real event. */
  async function parentOf(b, id, ev) {
    if (ev.parent_id) return ev.parent_id === '__root__' ? null : ev.parent_id;
    const page = await api(b, '/api/conversations/' + id + '/events/search?sort_order=TIMESTAMP_DESC&limit=100&timestamp__lt='
      + encodeURIComponent(ev.timestamp));
    const prev = (page.items || []).find((e) => e.kind !== 'ConversationStateUpdateEvent');
    return prev ? prev.id : null;
  }

  async function editLast(setText) {
    const b = backend(); const id = cid();
    if (!id) throw new Error('open a conversation first');
    const info = await api(b, '/api/conversations/' + id);
    if (info.execution_status === 'running') {
      setText('… stopping the agent');
      await api(b, '/api/conversations/' + id + '/pause', { method: 'POST' });
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        const s = (await api(b, '/api/conversations/' + id)).execution_status;
        if (s !== 'running') break;
        if (i === 29) throw new Error('the agent did not stop');
      }
    }
    const ev = await lastUserMessage(b, id);
    if (!ev) throw new Error('no message of yours in this conversation');
    const text = textOf(ev);
    const preview = text.length > 160 ? text.slice(0, 160) + '…' : text;
    if (!confirm('Edit your last message?\n\n"' + preview + '"\n\nIt and everything after it leave the conversation; '
      + 'its text goes back in the box to edit and send again.')) return false;
    setText('… rewinding');
    const parent = await parentOf(b, id, ev);
    await api(b, '/api/conversations/' + id + '/navigate', { method: 'POST', body: JSON.stringify({ event_id: parent }) });
    try {   // the app's own saved draft: the composer restores it when the conversation opens
      const key = 'conversation-state-' + id;
      const st = JSON.parse(localStorage.getItem(key) || '{}') || {};
      st.draftMessage = text;
      localStorage.setItem(key, JSON.stringify(st));
    } catch (e) { /* draft is a convenience */ }
    setTimeout(() => location.reload(), 150);
    return true;
  }

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

  function inject(menu) {
    if (!cid() || menu.querySelector('[data-testid="' + ITEM_ID + '"]')) return;
    const tpl = menu.querySelector('[data-testid="show-skills-button"]') || menu.querySelector('[data-testid$="-button"]');
    if (!tpl) return;
    const item = tpl.cloneNode(true);
    item.setAttribute('data-testid', ITEM_ID);
    item.removeAttribute('disabled'); item.removeAttribute('aria-disabled');
    setLabel(item, LABEL);
    let busy = false;
    item.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (busy) return; busy = true;
      try {
        const done = await editLast((t) => setLabel(item, t));
        if (!done) { setLabel(item, LABEL); closeMenu(); }
      } catch (e) { setLabel(item, 'edit failed: ' + e.message); }
      finally { busy = false; }
    });
    // right after the ASK/AUTO item when it is there, else first
    const mode = menu.querySelector('[data-testid="oh-mode-toggle-button"]');
    menu.insertBefore(item, mode ? mode.nextSibling : menu.firstChild);
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
