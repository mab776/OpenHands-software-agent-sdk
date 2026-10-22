/* OpenHands "pull down on the header to reload". (2026-10-22, v3 — sticky claim, early cancel)
   Marc's phone opens the canvas in Hermit, which has no easy refresh.
   v1 (pointer events) failed: header buttons capture pointers, so the window never saw the drag.
   v2 (touch events) worked but intermittently: it let the first moves pass un-cancelled while
   deciding intent, and Android WebView then often armed its own scroll/pull-to-refresh and killed
   our stream with touchcancel — whoever won the race decided whether it worked. Curved thumb drags
   also got permanently rejected by v2's single-shot claim check.
   v3: (a) as soon as a drag from the header strip is downward-dominant (>=4 px), preventDefault it
   BEFORE the browser can arm, so touchcancel never fires mid-gesture; (b) intent is sticky — judged
   on cumulative displacement every move, so a wobbly or curved thumb still claims; (c) extra fingers
   are ignored instead of cancelling; (d) if the system steals a ready gesture (touchcancel), release
   still reloads. Taps, horizontal drags (the tab chip row scrolls!), upward scrolls, inputs, dialogs
   and menus are untouched. */
(() => {
  if (window.__ohPullRefresh) return;
  window.__ohPullRefresh = true;

  const HEAD_STRIP = 110;   // px from top treated as "the header" (covers safe-area + bar)
  const CANCEL_AT = 4;      // px of downward-dominant travel where we start cancelling native scroll
  const CLAIM = 12;         // px (damped later) where the pill appears
  const THRESHOLD = 40;     // damped px for "release to reload" (~80 px of finger travel)
  const ID = 'oh-pull-refresh';

  const css = document.createElement('style');
  css.textContent = `
    #${ID} { position: fixed; top: -60px; left: 50%; transform: translateX(-50%); z-index: 2147483000;
      display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 9999px;
      background: rgba(20,20,24,.92); color: #eee; font: 500 13px/1.2 system-ui, sans-serif;
      box-shadow: 0 4px 14px rgba(0,0,0,.35); pointer-events: none; transition: top .18s ease; }
    #${ID}.on { top: max(env(safe-area-inset-top), 6px); }
    #${ID} svg { width: 16px; height: 16px; transition: transform .1s linear; }`;
  (document.head || document.documentElement).appendChild(css);

  const pill = document.createElement('div');
  pill.id = ID;
  pill.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" '
    + 'stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>'
    + '<span class="lbl">Pull to reload</span>';
  document.documentElement.appendChild(pill);
  const arrow = pill.querySelector('svg');
  const label = pill.querySelector('.lbl');

  let active = false, claimed = false, ready = false, y0 = 0, x0 = 0, dy = 0, dx = 0;
  const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

  const reset = () => {
    active = claimed = ready = false; dy = dx = 0;
    pill.classList.remove('on');
    label.textContent = 'Pull to reload';
  };
  const release = () => {                       // gesture abandoned: hand control back to the page
    active = claimed = ready = false;
    pill.classList.remove('on');
  };

  addEventListener('touchstart', (e) => {
    if (!active && e.touches.length === 1) {
      const t = e.touches[0];
      const el = e.target;
      if (t.clientY <= HEAD_STRIP && !(el.closest
          && el.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"]'))) {
        active = true; claimed = false; ready = false; y0 = t.clientY; x0 = t.clientX; dy = dx = 0;
      }
    }
  }, { passive: true });

  // Non-passive, but only ever cancels a downward-dominant drag that started on the header.
  addEventListener('touchmove', (e) => {
    if (!active || e.touches.length === 0) return;
    const t = e.touches[0];
    dy = t.clientY - y0;
    dx = t.clientX - x0;
    if (dy < -12) { release(); return; }                       // intent is up: native scroll may proceed
    if (!claimed && dy < CLAIM && Math.abs(dx) > 24 && Math.abs(dx) > dy * 2) { release(); return; }
    if (dy >= CANCEL_AT && dy > Math.abs(dx) * 0.8) e.preventDefault();
    if (!claimed && dy >= CLAIM && dy > Math.abs(dx)) {
      claimed = true;
      pill.classList.add('on');
      buzz(10);
    }
    if (!claimed) return;
    const shown = dy * 0.5;                    // rubber-band damping, display + threshold only
    arrow.style.transform = `rotate(${Math.min(shown, 180) * 2}deg)`;
    const was = ready;
    ready = shown >= THRESHOLD;
    label.textContent = ready ? 'Release to reload' : 'Pull to reload';
    if (ready && !was) buzz(20);
  }, { passive: false });

  const end = () => {
    if (!active) return;
    const go = claimed && ready;
    reset();
    if (go) { buzz(30); location.reload(); }
  };
  addEventListener('touchend', end, { passive: true });
  addEventListener('touchcancel', () => {      // system stole the pointer mid-gesture
    if (!active) return;
    const go = claimed && ready;
    reset();
    if (go) { buzz(30); location.reload(); }
  }, { passive: true });
})();
