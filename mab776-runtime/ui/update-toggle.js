/* OpenHands "show update" toggle. (2026-10-23)
   Marc: the update block (sidebar version tile "A new version is available" + settings update card)
   is annoying; he wants it behind a settings switch, mirroring the shipped "show getting started
   checklist" switch. The app ships no such setting, so: hide via CSS while
   localStorage["openhands-show-update-block"] !== "true" (default HIDDEN), and in the settings page
   clone the shipped checklist switch row into an adjacent row wired to our own key. The clone is
   rebuilt with plain DOM (React never owns it, its fiber props are dropped), so clicking cannot
   reach the checklist store. index.html is no-store, so this script itself always ships fresh. */
(() => {
  if (window.__ohUpdateToggle) return;
  window.__ohUpdateToggle = true;

  const KEY = "openhands-show-update-block";
  const show = () => localStorage.getItem(KEY) === "true";

  const css = document.createElement("style");
  css.textContent = `
    html:not(.oh-show-update) [data-testid="agent-canvas-version-tile"],
    html:not(.oh-show-update) [data-testid="agent-canvas-update-card"],
    html:not(.oh-show-update) [data-testid="agent-canvas-update-toggle"] { display: none !important; }`;
  (document.head || document.documentElement).appendChild(css);

  const apply = () => document.documentElement.classList.toggle("oh-show-update", show());
  apply();

  const LABEL = "Show update block";

  /* Build our own switch row shaped like the shipped settings-switch (label > hidden checkbox +
     track + thumb) but with self-owned visual state via inline styles — the shipped component
     bakes checked/unchecked positions into React-rendered classes, which a clone cannot follow. */
  function makeRow(modelInput) {
    const modelLabel = modelInput.closest("label");
    if (!modelLabel) return null;
    const row = document.createElement("div");
    row.setAttribute("data-oh-upd", "1");
    const label = document.createElement("label");
    label.className = "flex items-center gap-2 w-fit cursor-pointer";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.hidden = true;
    const track = document.createElement("span");
    track.setAttribute("aria-hidden", "true");
    track.className = "relative inline-flex shrink-0 items-center rounded-full h-5.5 w-10 border border-contrast transition-colors duration-200";
    const thumb = document.createElement("span");
    thumb.className = "inline-block rounded-full size-4 bg-contrast transition-transform duration-200";
    track.appendChild(thumb);
    const set = (on) => {
      input.checked = on;
      track.style.backgroundColor = on ? "var(--oh-accent, currentColor)" : "transparent";
      // e-ink: --oh-accent is black and the thumb's bg-contrast is also black,
      // so without this the ON state reads as a solid pill with no thumb.
      thumb.style.backgroundColor = on ? "#fff" : "";
      thumb.style.transform = on ? "translateX(21px)" : "translateX(2px)";
    };
    const text = document.createElement("div");
    text.className = "flex items-center gap-1";
    const span = document.createElement("span");
    span.className = "text-sm";
    span.textContent = LABEL;
    text.appendChild(span);
    label.append(text, track, input);
    row.appendChild(label);
    set(show());
    label.addEventListener("click", (ev) => {
      ev.preventDefault();
      localStorage.setItem(KEY, show() ? "false" : "true");
      set(show());
      apply();
    });
    return row;
  }

  let scheduled = false;
  const tryInsert = () => {
    if (document.querySelector('[data-oh-upd="1"]')) return;
    const src = document.querySelector('[data-testid="show-getting-started-checklist-switch"]');
    if (!src) return;
    const row = makeRow(src);
    if (row) src.closest("label").after(row);
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; tryInsert(); });
  };

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  // re-apply when another tab flips the setting
  window.addEventListener("storage", (e) => { if (e.key === KEY) apply(); });
})();
