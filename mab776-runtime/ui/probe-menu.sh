#!/bin/bash
# Render the Agent Canvas UI in the container's OWN headless Chromium (driven over CDP, no
# playwright needed — node >= 22 has a built-in WebSocket) and report on the injected ASK/AUTO
# item: label text on the home page and, if a conversation id is given, on that conversation.
# Also writes mobile-viewport screenshots to /tmp/oh-probe-home.png / /tmp/oh-probe-conv.png.
#
#   ./probe-menu.sh                 # home page only
#   ./probe-menu.sh <conversation-uuid>
#
# Why this exists: `chromium --dump-dom` on a fresh profile lands on the FIRST-RUN ONBOARDING
# MODAL and never shows the composer. Driving CDP lets us click [data-testid="onboarding-skip"],
# open the + menu and read the real DOM. It does NOT tap the toggle (read-only probe).
set -euo pipefail
CID="${1:-}"
cat > /tmp/oh-probe-menu.mjs <<'MJS'
const CID = process.argv[2] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = await import('node:fs');
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') logs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? ('ERR ' + String(r.result?.exceptionDetails?.text)); };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
const probe = async (url, png) => {
  await send('Page.navigate', { url }); await sleep(6000);
  await ev(`document.querySelector('[data-testid="onboarding-skip"]')?.click()`); await sleep(2000);
  await ev(`document.querySelector('[data-testid="chat-plus-button"]')?.click()`); await sleep(1200);
  const r = JSON.parse(await ev(`JSON.stringify({
    injected: !!window.__ohModeMenu, menu: !!document.querySelector('[data-testid="tools-context-menu"]'),
    item_label: document.querySelector('[data-testid="oh-mode-toggle-button"]')?.textContent.trim() ?? 'NO ITEM',
    items: [...document.querySelectorAll('[data-testid="tools-context-menu"] > [data-testid], [data-testid="tools-context-menu"] > div > [data-testid]')].map(e=>e.getAttribute('data-testid'))
  })`));
  const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(png, Buffer.from(s.result.data, 'base64'));
  return r;
};
const out = { home: await probe('http://127.0.0.1:8000/canvas', '/tmp/oh-probe-home.png') };
if (CID) out.conversation = await probe(`http://127.0.0.1:8000/canvas/conversations/${CID}`, '/tmp/oh-probe-conv.png');
out.exceptions = logs.slice(0, 6);
console.log(JSON.stringify(out, null, 2));
ws.close(); process.exit(0);
MJS
docker cp /tmp/oh-probe-menu.mjs openhands:/tmp/oh-probe-menu.mjs
docker exec -d openhands sh -c 'rm -rf /tmp/oh-chrome; chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=/tmp/oh-chrome about:blank >/tmp/oh-chrome.log 2>&1'
until docker exec openhands curl -s -m 2 http://127.0.0.1:9222/json/version >/dev/null; do sleep 1; done
docker exec openhands node /tmp/oh-probe-menu.mjs "$CID"
docker cp openhands:/tmp/oh-probe-home.png /tmp/oh-probe-home.png 2>/dev/null || true
[ -n "$CID" ] && docker cp openhands:/tmp/oh-probe-conv.png /tmp/oh-probe-conv.png 2>/dev/null || true
docker exec openhands sh -c 'pkill -f "remote-debugging-port=9222"; rm -rf /tmp/oh-chrome /tmp/oh-probe-menu.mjs /tmp/oh-probe-*.png /tmp/oh-chrome.log' || true
rm -f /tmp/oh-probe-menu.mjs
echo "screenshots: /tmp/oh-probe-home.png${CID:+ /tmp/oh-probe-conv.png}"
