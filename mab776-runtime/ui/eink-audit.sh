#!/usr/bin/env bash
# E-ink audit for the OpenHands canvas (2026-09-25) — "will other bad spots be found later?"
#
#   openhands/ui/eink-audit.sh [conversation-uuid]      # default: the most recent conversation
#
# Drives the container's own headless Chromium (CDP, no playwright) with the E-INK theme on, walks
# every page and every menu / popover / dropdown it knows how to open, and for each state reports:
#   UNSAFE  what is STILL wrong after eink-theme.css + eink-guard.js — fills that dither on a colour
#           e-paper panel (translucent, pale tint, mid grey, LARGE dark panels) and text under 4.5:1.
#           Should be empty. Includes a state with every action expanded, scanned over the whole page
#           (the command/output "code dump", tablet photo 2026-09-28).
#   GUARD   what eink-guard.js had to fix at runtime (window.__ohEinkGuard.log): spots the CSS does
#           not cover yet. Harmless (already fixed on screen) but each line is a candidate for a
#           proper rule in eink-theme.css, and NEW lines after an image update = new components.
# Exit code 0 always; read the report. Screenshots of every state: /tmp/oh-eink-audit/*.png
# (delete them when done). Leaves no browser, profile or theme setting behind.
set -euo pipefail
CID="${1:-}"
OUT=/tmp/oh-eink-audit; rm -rf "$OUT"; mkdir -p "$OUT"
if [ -z "$CID" ]; then
  K=$(curl -s http://192.168.0.70:3003/canvas/ | grep -oE '__AGENT_CANVAS_SESSION_API_KEY__\s*=\s*"[0-9a-f]+"' | grep -oE '[0-9a-f]{32,}')
  CID=$(curl -s -H "X-Session-API-Key: $K" "http://192.168.0.70:3003/api/conversations/search?limit=1" \
        | python3 -c 'import sys,json;it=json.load(sys.stdin).get("items",[]);print(it[0]["id"] if it else "")')
fi
cat > /tmp/oh-eink-audit.mjs <<'MJS'
const CID = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = await import('node:fs');
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 160)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? ('ERR ' + String(r.result?.exceptionDetails?.text)); };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/oh-eink-audit-' + name + '.png', Buffer.from(s.result.data, 'base64')); };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1300, deviceScaleFactor: 1, mobile: true });

const AUDIT_FN = (full) => `((FULL) => {
  const parse = (c) => { const m = c && c.match(/[\\d.]+/g); if (!m || m.length < 3) return null; const [r,g,b,a=1] = m.map(Number); return {r,g,b,a}; };
  const lum = (c) => { const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}; return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); };
  const ch = (c) => Math.max(c.r,c.g,c.b)-Math.min(c.r,c.g,c.b);
  const over = (t,u) => ({r:t.r*t.a+u.r*(1-t.a),g:t.g*t.a+u.g*(1-t.a),b:t.b*t.a+u.b*(1-t.a),a:1});
  const behind = (el) => { const st=[]; for (let e=el.parentElement;e;e=e.parentElement){const c=parse(getComputedStyle(e).backgroundColor); if(c&&c.a>0){st.push(c); if(c.a>=0.999)break;}} let b={r:255,g:255,b:255,a:1}; for(let i=st.length-1;i>=0;i--) b=over(st[i],b); return b; };
  const where = (el) => { const t=el.closest('[data-testid]'); return (t?t.getAttribute('data-testid'):'?')+' <'+el.tagName.toLowerCase()+' '+String(el.getAttribute('class')||'').slice(0,50)+'>'; };
  const bad = new Map(); const vw = innerWidth*innerHeight;
  for (const el of document.querySelectorAll('[data-agent-server-ui] *')) {
    if (el.closest('svg') || el.closest('.xterm')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || (!FULL && (r.bottom < 0 || r.top > innerHeight))) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden') continue;
    const c = parse(cs.backgroundColor);
    if (c && c.a > 0 && r.width*r.height >= 30) {
      const eff = c.a < 0.999 ? over(c, behind(el)) : c; const L = lum(eff), k = ch(eff);
      let why = null;
      if (c.a < 0.999 && r.width*r.height < 0.4*vw) why = 'translucent';
      else if (k > 24 && L > 0.45) why = 'pale-tint';
      else if (k <= 24 && L > 0.12 && L < 0.83) why = 'mid-grey';
      else if (k <= 24 && L <= 0.12 && r.width*r.height >= 20000 && r.width*r.height < 0.6*vw) why = 'dark-panel';
      if (why) bad.set(why+' '+cs.backgroundColor+' @ '+where(el), 1);
    }
    if ([...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())) {
      const fg = parse(cs.color); const bg = c && c.a >= 0.999 ? c : behind(el);
      if (fg) { const f = over(fg, bg); const L1=lum(f), L2=lum(bg); const ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
        if (ratio < 4.5) bad.set('text '+ratio.toFixed(1)+':1 "'+el.textContent.trim().slice(0,20)+'" '+cs.color+' on '+cs.backgroundColor+' @ '+where(el), 1); }
    }
  }
  return JSON.stringify([...bad.keys()]);
})(${full})`;
const AUDIT = AUDIT_FN(false);
const report = [];
async function state(name, setup, full = false) {
  try { await setup(); } catch (e) { report.push({ name, error: String(e).slice(0, 120) }); return; }
  await sleep(900);                                     // let the guard's 60 ms debounce + paint settle
  const unsafe = JSON.parse(await ev(AUDIT_FN(full)));
  report.push({ name, unsafe });
  await shot(name.replace(/[^a-z0-9]+/gi, '-'));
}
const click = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'missing'; e.click(); return 'ok';})()`);
const esc = async () => {   // a REAL key press (synthetic KeyboardEvents don't close HeroUI/cmdk layers)
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(300);
};
const go = async (path) => { await send('Page.navigate', { url: 'http://127.0.0.1:8000/canvas' + path }); await sleep(7000); await ev(`document.querySelector('[data-testid="onboarding-skip"]')?.click()`); await sleep(600); };
const opener = (sel) => async () => { const r = await click(sel); if (r === 'missing') throw new Error('no ' + sel); await sleep(700); };

await go('?oh-theme=eink');
await state('home', async () => {});
await state('home + menu', opener('[data-testid="chat-plus-button"]')); await esc();
await state('home profile menu', opener('[data-testid="chat-input-llm-profile"]')); await esc();
await state('backend selector', opener('[data-testid="dropdown-trigger"]')); await esc();
await state('command menu (search)', opener('[data-testid="command-menu-trigger"]')); await esc();
await state('new thread picker', opener('[data-testid="conversation-panel-new-thread-picker"]')); await esc();
await state('conversation layouts', opener('[data-testid="conversation-layouts-toggle"]')); await esc();
await state('conversation card menu', opener('[data-testid="ellipsis-button"]')); await esc();
if (CID) {
  await go('/conversations/' + CID);
  await state('conversation', async () => {});
  // The "code dump" (tablet photo 2026-09-28): an expanded action renders its command + output through a
  // syntax highlighter that the collapsed view never shows. Open every action group ONCE, then every action
  // ONCE (a second click collapses again), and scan the WHOLE page, not just the viewport.
  // The expand control is the <button> around/next to the action title — clicking the title div does nothing.
  await state('conversation, all actions expanded (whole page)', async () => {
    const opened = await ev(`(()=>{let n=0; document.querySelectorAll('[data-testid="event-group-toggle"]').forEach(e=>{e.click();n++;}); return n;})()`);
    await sleep(1500);
    const actions = await ev(`(()=>{let n=0; document.querySelectorAll('[data-testid="generic-event-message-title"]').forEach(t=>{const b=t.closest('button')||t.parentElement.querySelector('button'); if(b){b.click();n++;}}); return n;})()`);
    await sleep(2500);
    const blocks = await ev(`document.querySelectorAll('[data-testid="chat-scroll-container"] div[style*="Menlo"]').length`);
    if (!blocks) throw new Error('expanded ' + opened + ' groups / ' + actions + ' actions but no code block rendered');
  }, true);
  await go('/conversations/' + CID);
  await state('conv + menu', opener('[data-testid="chat-plus-button"]')); await esc();
  await state('conv profile menu', opener('[data-testid="chat-input-llm-profile"]')); await esc();
  await state('context window popover', opener('[data-testid="context-window-meter"]'));
  await state('usage dialog', opener('[data-testid="context-window-plan-usage"]')); await esc(); await esc();
  await state('server status menu', opener('[data-testid="server-status-menu-trigger"]')); await esc();
  await state('git actions', opener('[data-testid="conversation-git-actions-toggle"]')); await esc();
  await state('conversation overview', opener('[data-testid="conversation-overview-toggle"]')); await esc();
  await state('right panel', opener('[data-testid="right-panel-toggle"]'));
  await click('[data-testid="right-panel-toggle"]');
}
for (const p of ['agent', 'llm', 'condenser', 'agent-context', 'verification', 'app', 'secrets']) {
  await go('/settings/' + p); await state('settings/' + p, async () => {});
}
await go(''); await state('customize', opener('[data-testid="sidebar-skills-link"]'));
await go(''); await state('automate', opener('[data-testid="sidebar-automations-link"]'));
const guard = JSON.parse(await ev(`JSON.stringify(window.__ohEinkGuard ? {fixed: window.__ohEinkGuard.fixed, runs: window.__ohEinkGuard.runs, log: window.__ohEinkGuard.log} : null)`));
await ev(`localStorage.removeItem('oh-theme')`);
console.log(JSON.stringify({ report, guard, errors: errors.slice(0, 5) }));
ws.close(); process.exit(0);
MJS
docker cp /tmp/oh-eink-audit.mjs openhands:/tmp/oh-eink-audit.mjs
docker exec -d openhands sh -c 'rm -rf /tmp/oh-chrome; chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=/tmp/oh-chrome about:blank >/tmp/oh-chrome.log 2>&1'
until docker exec openhands curl -s -m 2 http://127.0.0.1:9222/json/version >/dev/null; do sleep 1; done
docker exec openhands node /tmp/oh-eink-audit.mjs "$CID" > "$OUT/result.json" || true
for f in $(docker exec openhands sh -c 'ls /tmp/oh-eink-audit-*.png 2>/dev/null'); do docker cp "openhands:$f" "$OUT/$(basename "$f" | sed 's/^oh-eink-audit-//')" 2>/dev/null; done
docker exec openhands sh -c 'pkill -f "remote-debugging-port=9222"; rm -rf /tmp/oh-chrome /tmp/oh-eink-audit.mjs /tmp/oh-eink-audit-*.png /tmp/oh-chrome.log' || true
rm -f /tmp/oh-eink-audit.mjs
python3 - "$OUT/result.json" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print("audit produced no JSON:", e); print(open(sys.argv[1]).read()[:800]); raise SystemExit(0)
total = 0
print("=== UNSAFE after CSS + guard (should be empty) ===")
for s in d["report"]:
    if "error" in s: print(f"  [{s['name']}] could not open: {s['error']}"); continue
    u = s["unsafe"]; total += len(u)
    print(f"  [{s['name']}] {'ok' if not u else str(len(u)) + ' issue(s)'}")
    for x in u[:8]: print("      -", x[:170])
print(f"  → {total} unsafe spot(s) across {len(d['report'])} states")
g = d.get("guard") or {}
print(f"\n=== GUARD fixed at runtime: {g.get('fixed', 0)} element(s), {len(g.get('log', []))} distinct ===")
for x in (g.get("log") or [])[:60]: print(f"  - {x['what']:<34} {x['where'][:110]}  ({x['from']})")
if d.get("errors"): print("\n=== page exceptions ===", *d["errors"], sep="\n  ")
PY
echo "screenshots: $OUT/*.png"
