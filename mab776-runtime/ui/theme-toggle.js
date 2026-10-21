/* OpenHands display theme (2026-09-24) — companion of light-theme.css + eink-theme.css.
   The app ships only a dark theme. This script applies the choice as early as possible and puts the
   control where a one-time choice belongs: Settings → Application, right under the app's own
   "Color Theme" selector (NOT in the composer's + menu — Marc: "it's a one time thing").

   localStorage["oh-theme"] = "auto" (default) | "light" | "eink" | "dark". Per browser: the tablet
   keeps e-ink, the phone keeps dark.
     auto → e-ink if the browser reports a slow-refresh screen (`update: slow`), else light/dark from
            the OS preference (`prefers-color-scheme`).
   Also accepts a one-shot URL parameter, e.g. …/canvas?oh-theme=eink (stored, then dropped from the URL). */
(() => {
  if (window.__ohTheme) return;
  window.__ohTheme = true;
  const KEY = 'oh-theme';
  const CHOICES = [
    ['auto', 'Auto (follow this device)'],
    ['light', 'Light'],
    ['eink', 'E-ink (colour e-paper)'],
    ['dark', 'Dark (app default)'],
  ];
  const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false });
  const get = () => { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } };
  const set = (v) => { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode */ } };
  const effective = (c) => {
    if (c !== 'auto') return c;
    if (mq('(update: slow)').matches) return 'eink';
    return mq('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  };
  function apply() {
    const e = effective(get());
    const root = document.documentElement;
    root.classList.toggle('oh-light', e === 'light' || e === 'eink');
    root.classList.toggle('oh-eink', e === 'eink');
    root.classList.remove('oh-epaper');           // v1 heuristic class, retired
  }
  // one-shot ?oh-theme=… (handy on a device where the Settings page is awkward)
  try {
    const u = new URL(location.href), p = u.searchParams.get('oh-theme');
    if (p && CHOICES.some(([k]) => k === p)) { set(p); u.searchParams.delete('oh-theme'); history.replaceState(null, '', u.toString()); }
  } catch (e) { /* ignore */ }
  apply();
  for (const q of ['(prefers-color-scheme: light)', '(update: slow)']) {
    const m = mq(q); if (m.addEventListener) m.addEventListener('change', apply);
  }

  /* ---- Settings → Application: a "Display" row under Color Theme ---- */
  const ROW_ID = 'oh-display-theme-row';
  function injectSettings() {
    if (document.getElementById(ROW_ID)) return;
    const anchor = document.querySelector('[data-testid="color-theme-input"]');
    if (!anchor) return;
    // The field is a <label> wrapping caption + select; its parent is the column of settings rows.
    let block = anchor.closest('label');
    if (!block || !block.parentElement) {
      block = anchor;
      while (block.parentElement && block.parentElement.children.length < 3) block = block.parentElement;
    }
    const row = document.createElement('div');
    row.id = ROW_ID;
    row.style.cssText = 'display:flex;flex-direction:column;gap:10px;width:100%';
    const label = document.createElement('label');
    label.htmlFor = ROW_ID + '-select';
    label.textContent = 'Display (this device only)';
    label.style.cssText = 'font-size:14px;font-weight:500;color:var(--oh-foreground)';
    const sel = document.createElement('select');
    sel.id = ROW_ID + '-select';
    sel.style.cssText = 'height:40px;padding:0 12px;border-radius:var(--oh-radius,8px);border:1px solid var(--oh-border-input);' +
      'background:var(--oh-bg-input,var(--oh-surface));color:var(--oh-foreground);font-size:14px;max-width:420px';
    for (const [k, t] of CHOICES) { const o = document.createElement('option'); o.value = k; o.textContent = t; sel.appendChild(o); }
    sel.value = get();
    const hint = document.createElement('p');
    const hintText = () => 'Now showing: ' + ({ light: 'Light', eink: 'E-ink', dark: 'Dark' })[effective(get())] +
      '. Stored in this browser; other devices keep their own choice.';
    hint.textContent = hintText();
    hint.style.cssText = 'font-size:12px;color:var(--oh-muted);margin:0';
    sel.addEventListener('change', () => { set(sel.value); apply(); hint.textContent = hintText(); });
    row.append(label, sel, hint);
    block.after(row);
  }
  const start = () => {
    new MutationObserver(() => { if (location.pathname.includes('/settings')) injectSettings(); })
      .observe(document.body, { childList: true, subtree: true });
    if (location.pathname.includes('/settings')) injectSettings();
  };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
})();
