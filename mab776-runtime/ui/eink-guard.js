/* OpenHands E-INK GUARD (2026-09-25) — the runtime safety net behind eink-theme.css.
   Only active while <html> has class "oh-eink".

   Why: the CSS layers fix what we have SEEN. The app (and HeroUI underneath) has ~90 other fill rules
   that are unsafe on a colour e-paper panel — translucent washes (bg-black/20, bg-primary/20…),
   pale tints and mid greys — plus hard-coded light text. Any of them can show up in a menu we have not
   opened yet, or after an image update. This guard looks at what is actually rendered and fixes it:
     - translucent fill: large (≥ 40 % of the viewport, i.e. a modal backdrop) → transparent;
                         otherwise → composited over what is behind, then snapped (below)
     - pale tint (light + coloured) → white
     - mid grey (neutral, 25–92 % luminance) → #eee, plus a blue left bar when it looks "selected"
     - text below 4.5:1 against its real background → #111 (or white on a dark fill)
   Every fix is recorded once in window.__ohEinkGuard.log ({what, where, from, to}) — the e-ink audit
   script (ui/eink-audit.sh) prints it, so a new unsafe spot shows up by name instead of in a photo.
   Fixes are inline !important styles, reverted and re-evaluated whenever the element's class or
   data-/aria- state changes (hover, selection…), so they never "stick" to a stale state. */
(() => {
  if (window.__ohEinkGuard) return;
  const G = (window.__ohEinkGuard = { log: [], seen: new Set(), fixed: 0, runs: 0 });
  const on = () => document.documentElement.classList.contains('oh-eink');
  const parse = (c) => { const m = c && c.match(/[\d.]+/g); if (!m || m.length < 3) return null; const [r, g, b, a = 1] = m.map(Number); return { r, g, b, a }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const chroma = (c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const where = (el) => {
    const t = el.closest('[data-testid]');
    const role = el.closest('[role]');
    return (t ? t.getAttribute('data-testid') : '?') + (role ? ' [' + role.getAttribute('role') + ']' : '') +
      ' <' + el.tagName.toLowerCase() + ' ' + String(el.getAttribute('class') || '').slice(0, 60) + '>';
  };
  const note = (what, el, from, to) => {
    G.fixed++;
    const key = what + '|' + where(el).replace(/<.*/, '') + '|' + from;
    if (G.seen.has(key) || G.log.length >= 300) return;
    G.seen.add(key); G.log.push({ what, where: where(el), from, to });
  };
  const set = (el, prop, val) => {
    el.__ohOrig ||= {};
    if (!(prop in el.__ohOrig)) el.__ohOrig[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
    el.style.setProperty(prop, val, 'important');
  };
  const restore = (el) => {
    if (!el.__ohOrig) return;
    for (const [p, [v, pr]] of Object.entries(el.__ohOrig)) { if (v) el.style.setProperty(p, v, pr); else el.style.removeProperty(p); }
    el.__ohOrig = null;
  };
  // effective background behind an element (first painted ancestor, composited)
  const behind = (el) => {
    const stack = [];
    for (let e = el.parentElement; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 0.999) break; }
    }
    let base = WHITE;
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const vw = () => window.innerWidth * window.innerHeight;

  function fixFill(el, cs) {
    const before = cs.backgroundColor;              // cs is LIVE: read before we change anything
    const c = parse(before);
    if (!c || c.a === 0) return null;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area < 30) return c;                                    // dots, ticks: leave
    let eff = c;
    if (c.a < 0.999) {
      if (area >= 0.4 * vw()) { set(el, 'background-color', 'transparent'); note('backdrop→transparent', el, before, 'transparent'); return behind(el); }
      eff = over(c, behind(el));
    }
    const L = lum(eff), ch = chroma(eff);
    let to = null;
    if (ch > 24 && L > 0.45) to = '#ffffff';                    // pale tint
    else if (ch <= 24 && L > 0.12 && L < 0.83) to = '#eeeeee';  // mid grey (sRGB ~#626262 … #ececec)
    // a LARGE near-black panel (a dark-theme code/terminal block: the 2026-09-28 "code dump") ghosts and
    // reads badly on paper → light panel; its text is darkened by fixText right after. Small dark shapes
    // (buttons, switches, ticks) stay.
    else if (ch <= 24 && L <= 0.12 && area >= 20000 && area < 0.6 * vw()) to = '#eeeeee';
    else if (c.a < 0.999) to = L > 0.5 ? (L > 0.9 ? '#ffffff' : '#eeeeee') : null;  // translucent wash, now opaque
    if (!to) return eff;
    set(el, 'background-color', to);
    // a mid/dark grey fill usually meant "selected / current" → keep that meaning as a bar
    if (ch <= 24 && L < 0.45 && L > 0.12 && area < 0.2 * vw()) set(el, 'box-shadow', 'inset 4px 0 0 #0047bb');
    if (L <= 0.12) set(el, 'color', '#111111');                 // was light text on the dark panel
    note(ch > 24 && L > 0.45 ? 'pale-tint→white' : L <= 0.12 ? 'dark panel→' + to : 'grey/translucent→' + to, el, before, to);
    return parse(to === '#ffffff' ? 'rgb(255,255,255)' : 'rgb(238,238,238)');
  }

  function fixText(el, cs, bgEff) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    const before = cs.color;
    const fg = parse(before); if (!fg) return;
    const bg = bgEff || behind(el);
    const f = over(fg.a < 1 ? fg : fg, bg), L1 = lum(f), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (ratio >= 4.5) return;
    const to = L2 > 0.4 ? '#111111' : '#ffffff';
    set(el, 'color', to);
    note('low-contrast text ' + ratio.toFixed(1) + ':1→' + to, el, before, to);
  }

  // Icons are text too: a hard-coded white/pale icon (e.g. the tick on the selected LLM profile) vanishes
  // on paper. Lucide icons draw with currentColor, so fixing `color` on the <svg> fixes the strokes.
  function fixIcon(svg) {
    if (!svg.closest('[data-agent-server-ui]') || svg.closest('.xterm')) return;
    restore(svg);
    const cs = getComputedStyle(svg);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = svg.getBoundingClientRect(); if (r.width < 6 || r.width > 64) return;   // icons only
    if (cs.filter && cs.filter !== 'none') return;                  // already handled in CSS (e.g. the inverted logo)
    // paint = the svg's stroke, else (filled icons, e.g. the profile tick) the first shape's fill
    const shapes = [...svg.querySelectorAll('path, polyline, polygon, circle, rect, line')];
    shapes.forEach(restore);
    let paint = cs.stroke && cs.stroke !== 'none' && !cs.stroke.startsWith('url') ? cs.stroke : null, filled = false;
    if (!paint && shapes[0]) { const f = getComputedStyle(shapes[0]).fill; if (f && f !== 'none' && !f.startsWith('url')) { paint = f; filled = true; } }
    if (!paint) paint = cs.color;
    const fg = parse(paint); if (!fg || fg.a === 0) return;
    const bg = behind(svg), L1 = lum(over(fg, bg)), L2 = lum(bg);
    // a dark icon with white CUT-OUTS (e.g. the Automate glyph) is fine: only act when EVERY shape is faint
    const contrast = (c) => { const p = parse(c); if (!p || p.a === 0) return 21; const a = lum(over(p, bg)); return (Math.max(a, L2) + 0.05) / (Math.min(a, L2) + 0.05); };
    if (shapes.some((sh) => { const st = getComputedStyle(sh); const pnt = st.fill && st.fill !== 'none' ? st.fill : (st.stroke !== 'none' ? st.stroke : null); return pnt && contrast(pnt) >= 3; })) return;
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (ratio >= 3) return;                                        // WCAG non-text contrast
    const to = L2 > 0.4 ? '#0047bb' : '#ffffff';
    set(svg, 'color', to); set(svg, 'stroke', to);
    // presentation attributes (fill="#fff") sit on the shapes themselves: override there
    if (filled) shapes.forEach((sh) => { const f = getComputedStyle(sh).fill; if (f && f !== 'none') set(sh, 'fill', to); });
    note('faint icon ' + ratio.toFixed(1) + ':1→' + to, svg, paint, to);
  }

  function check(el) {
    if (el instanceof SVGSVGElement) { fixIcon(el); return; }
    if (!(el instanceof HTMLElement) || el.closest('svg') || el.closest('.xterm')) return;
    if (!el.closest('[data-agent-server-ui]')) return;
    restore(el);
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const bg = fixFill(el, cs);
    fixText(el, cs, bg && bg.a >= 0.999 ? bg : null);
    outlineFloating(el, cs, bg);
  }

  // Floating layers (menus, popovers, list boxes, dialogs): the dark theme separated them from the page
  // with a shadow, which e-ink removes → white on white with no edge. Any positioned, stacked, opaque
  // light box of popover size without a visible border gets a dark outline.
  function outlineFloating(el, cs, bg) {
    if (cs.position !== 'absolute' && cs.position !== 'fixed') return;
    const z = parseInt(cs.zIndex, 10); if (!(z >= 10)) return;
    if (!bg || bg.a < 0.999 || lum(bg) < 0.8) return;
    if (parseFloat(cs.borderTopWidth) >= 1 && lum(parse(cs.borderTopColor) || WHITE) < 0.6) return;
    const r = el.getBoundingClientRect(), area = r.width * r.height;
    if (area < 2500 || area > 0.7 * vw()) return;
    set(el, 'border', '1.5px solid #333333');
    note('floating layer outlined', el, cs.borderTopWidth + ' ' + cs.borderTopColor, '1.5px #333');
  }

  let queue = new Set(), timer = 0;
  const flush = () => {
    timer = 0;
    if (!on()) { queue.clear(); return; }
    G.runs++;
    const items = [...queue]; queue.clear();
    for (const root of items) {
      if (!root.isConnected) continue;
      check(root);
      if (root.__ohDeep) { root.__ohDeep = false; root.querySelectorAll('*').forEach((e) => { if (!(e.parentElement && e.parentElement.closest('svg'))) check(e); }); }
    }
  };
  const enqueue = (el, deep) => { if (!(el instanceof HTMLElement) && !(el instanceof SVGSVGElement)) return; if (deep) el.__ohDeep = true; queue.add(el); if (!timer) timer = setTimeout(flush, 60); };

  const start = () => {
    new MutationObserver((muts) => {
      if (!on()) return;
      for (const m of muts) {
        if (m.type === 'childList') m.addedNodes.forEach((n) => enqueue(n, true));
        else enqueue(m.target, m.target.getElementsByTagName('*').length < 400);
      }
    }).observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'data-hover', 'data-selected', 'data-focus', 'data-active', 'data-state',
        'data-open', 'data-pressed', 'aria-selected', 'aria-current', 'aria-expanded', 'data-focus-visible'],
    });
    // full pass once the app has rendered, and whenever e-ink gets switched on
    const full = () => { if (on()) enqueue(document.body, true); };
    setTimeout(full, 800);
    new MutationObserver(full).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
  G.rescan = () => enqueue(document.body, true);
})();
