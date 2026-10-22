/* OpenHands "pull down on the header to reload". (2026-10-22)
   Marc's phone opens the canvas in Hermit, which has no easy refresh. Hermit's own pull-to-refresh
   does not fire reliably on this SPA (WebView only arms it when the document itself scrolls at top).
   This script lives in index.html (served no-store), so it is always present: a touch that starts in
   the top header strip (<=72 px) and drags clearly downward claims the gesture (preventDefault),
   shows a "release to reload" pill, and on release past the threshold calls location.reload().
   Taps, horizontal swipes, and drags starting anywhere else are untouched. */
(() => {
  if (window.__ohPullRefresh) return;
  window.__ohPullRefresh = true;

  const HEAD_STRIP = 72;      // px from top considered "the header"
  const CLAIM = 14;           // px of vertical travel before we claim the gesture
  const THRESHOLD = 60;       // damped px needed for "release to reload"
  const ID = 'oh-pull-refresh';

  const css = document.createElement('style');
  css.textContent = `
    #${ID} { position: fixed; top: -60px; left: 50%; transform: translateX(-50%); z-index: 2147483000;
      display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 9999px;
      background: rgba(20,20,24,.92); color: #eee; font: 500 13px/1.2 system-ui, sans-serif;
      box-shadow: 0 4px 14px rgba(0,0,0,.35); pointer-events: none; transition: top .18s ease; }
    #${ID}.on { top: max(env(safe-area-inset-top), 6px); }
    #${ID} svg { width: 16px; height: 16px; transition: transform .1s linear; }
    #${ID} .lbl { min-width: 92px; }`;
  (document.head || document.documentElement).appendChild(css);

  const pill = document.createElement('div');
  pill.id = ID;
  pill.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" '
    + 'stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>'
    + '<span class="lbl">Pull to reload</span>';
  document.documentElement.appendChild(pill);
  const arrow = pill.querySelector('svg');
  const label = pill.querySelector('.lbl');

  let pid = null, y0 = 0, x0 = 0, dy = 0, claimed = false, ready = false;

  const reset = () => {
    pid = null; claimed = false; ready = false; dy = 0;
    pill.classList.remove('on');
    label.textContent = 'Pull to reload';
  };

  addEventListener('pointerdown', (e) => {
    if (pid !== null || !e.isPrimary || e.pointerType === 'mouse') return;
    if (e.clientY > HEAD_STRIP) return;
    const t = e.target;
    if (t.closest && t.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"]')) return;
    pid = e.pointerId; y0 = e.clientY; x0 = e.clientX; claimed = false; ready = false;
  }, { passive: true });

  addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    const ddy = e.clientY - y0, ddx = e.clientX - x0;
    if (!claimed) {
      if (ddy < CLAIM || Math.abs(ddy) < Math.abs(ddx) * 1.5) return;
      claimed = true;
      pill.classList.add('on');
      if (navigator.vibrate) navigator.vibrate(10);
    }
    dy = ddy * 0.5;                        // rubber-band damping
    arrow.style.transform = `rotate(${Math.min(dy, 180) * 2}deg)`;
    const wasReady = ready;
    ready = dy >= THRESHOLD;
    label.textContent = ready ? 'Release to reload' : 'Pull to reload';
    if (ready && !wasReady && navigator.vibrate) navigator.vibrate(20);
  }, { passive: true });

  // WebView: preventDefault on pointermove does NOT stop native scroll — touchmove does.
  // Non-passive, but only ever cancels once the gesture was claimed by a header pull.
  addEventListener('touchmove', (e) => { if (claimed) e.preventDefault(); }, { passive: false });

  const up = (e) => {
    if (e.pointerId !== pid) return;
    const go = claimed && ready;
    reset();
    if (go) { if (navigator.vibrate) navigator.vibrate(30); location.reload(); }
  };
  addEventListener('pointerup', up, { passive: true });
  addEventListener('pointercancel', () => { if (pid !== null) reset(); }, { passive: true });
})();
