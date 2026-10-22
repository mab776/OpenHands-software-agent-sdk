/* OpenHands "pull down on the header to reload". (2026-10-22, v2 — touch events)
   Marc's phone opens the canvas in Hermit, which has no easy refresh. v1 used pointer events and the
   whole header strip: header buttons capture pointers (setPointerCapture), so drags starting on the
   buttons never reached the window listener. v2 listens to TOUCH events, which bubble from buttons no
   matter what; the whole top bar (<=110 px, incl. safe-area) claims a clear downward drag, shows a
   "release to reload" pill, and reloads on release past the threshold. Taps, horizontal swipes, drags
   starting lower down, and gestures inside inputs/dialogs/menus are untouched. */
(() => {
  if (window.__ohPullRefresh) return;
  window.__ohPullRefresh = true;

  const HEAD_STRIP = 110;     // px from top treated as "the header" (covers safe-area + bar)
  const CLAIM = 10;           // px of downward travel before we claim the gesture
  const THRESHOLD = 40;       // damped px needed for "release to reload" (~80 px of finger travel)
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

  let active = false, claimed = false, ready = false, y0 = 0, x0 = 0, dy = 0;
  const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

  const reset = () => {
    active = claimed = ready = false; dy = 0;
    pill.classList.remove('on');
    label.textContent = 'Pull to reload';
  };

  addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { reset(); return; }
    const t = e.touches[0];
    if (t.clientY > HEAD_STRIP) return;
    const el = e.target;
    if (el.closest && el.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"]')) return;
    active = true; claimed = false; ready = false; y0 = t.clientY; x0 = t.clientX;
  }, { passive: true });

  // Non-passive: only cancels native scroll once a header pull has been claimed.
  addEventListener('touchmove', (e) => {
    if (!active || e.touches.length !== 1) return;
    const t = e.touches[0];
    const ddy = t.clientY - y0, ddx = t.clientX - x0;
    if (!claimed) {
      if (ddy < CLAIM || Math.abs(ddy) < Math.abs(ddx) * 1.3) { active = false; return; }
      claimed = true;
      pill.classList.add('on');
      buzz(10);
    }
    e.preventDefault();
    dy = ddy * 0.5;                       // rubber-band damping
    arrow.style.transform = `rotate(${Math.min(dy, 180) * 2}deg)`;
    const was = ready;
    ready = dy >= THRESHOLD;
    label.textContent = ready ? 'Release to reload' : 'Pull to reload';
    if (ready && !was) buzz(20);
  }, { passive: false });

  const end = (e) => {
    if (!active) return;
    const go = claimed && ready;
    reset();
    if (go) { buzz(30); location.reload(); }
  };
  addEventListener('touchend', end, { passive: true });
  addEventListener('touchcancel', reset, { passive: true });
})();
