#!/usr/bin/env python3
"""Inject the local UI add-ons into agent-canvas's index.html at container start.

Add-ons (all in /oh-ui, a read-only directory bind mount):
  mode-toggle.js   ASK/AUTO item in the composer's "+" menu                         (2026-09-21)
  light-theme.css  light theme behind <html class="oh-light">                         (2026-09-24)
  eink-theme.css   colour e-paper layer behind <html class="oh-light oh-eink">         (2026-09-24)
  theme-toggle.js  applies the theme choice; "Display" row in Settings → Application (2026-09-24)
  edit-last.js     "Edit my last message" IN PLACE in the "+" menu (navigate HEAD back; host patch 2)  (2026-10-19)
  effort-menu.js   "🧠 Thinking" Low/Medium/High list in the "+" menu (per conversation; host patch 3)       (2026-10-19)
  voice-seed.js    pre-fills the dictation (speech-to-text) address on the https :8446 page         (2026-10-20)
  pause-guard.js   own ⏸ button when the app hides its pause (narrow screens, stale cached bundle)   (2026-10-20)
  eink-guard.js    runtime safety net for e-ink: snaps any unsafe fill / low-contrast text the CSS
                   missed, and logs what it fixed (window.__ohEinkGuard)             (2026-09-25)
  + GENERATED here: the HeroUI component palette for light / e-ink (see heroui_css()).

Runs against WHATEVER index.html (and CSS) the image ships, so an image update cannot leave us pinned
to stale hash-named asset references (which is exactly what bind-mounting a copy of index.html would
do -> white screen).

RE-INJECTS on every start: any previously injected block is stripped first, so editing a file in
ui/ needs only `docker restart openhands` — no container recreate.

Fail-open by design: any error must never stop the app booting (the entrypoint calls it `|| true`).
The CSS goes in <head> (so the first paint is right); the scripts go before </body>.
"""
import pathlib
import re
import sys

INDEX = pathlib.Path("/opt/agent-canvas/frontend/index.html")
ASSETS = pathlib.Path("/opt/agent-canvas/frontend/assets")
UI = pathlib.Path("/oh-ui")
CSS_MARK = "oh-light-theme-injected"
JS_MARK = "oh-mode-pill-injected"           # historical id, now holds ALL scripts
CSS_BLOCK = re.compile(r'<style id="%s">.*?</style>' % re.escape(CSS_MARK), re.DOTALL)
JS_BLOCK = re.compile(r'<script id="%s">.*?</script>' % re.escape(JS_MARK), re.DOTALL)
SCRIPTS = ["voice-seed.js", "pause-guard.js", "pull-refresh.js", "mode-toggle.js", "edit-last.js", "effort-menu.js", "theme-toggle.js", "eink-guard.js"]
STYLES = ["light-theme.css", "eink-theme.css"]

# HeroUI (the component library behind dropdowns, list boxes, modals, selects…) has its OWN colour
# tokens, --heroui-*, as "H S% L%" triplets. The app only ever activates `.dark`; the image also ships
# a complete `[data-agent-server-ui] .light{…}` block that nothing uses. We lift that block out of the
# shipped CSS at start (so it follows image updates) and apply it in light mode; e-ink gets a
# neutralised, 16-level version of it. Without this, every HeroUI popover stays dark-palette:
# the tablet's LLM-profile menu (2026-09-25 photo) was the visible symptom.
SCOPE_LIGHT = ("html.oh-light [data-agent-server-ui], html.oh-light [data-agent-server-ui] .dark, "
               "html.oh-light [data-agent-server-ui] [data-theme=dark]")
SCOPE_EINK = SCOPE_LIGHT.replace("html.oh-light", "html.oh-light.oh-eink")
# e-ink ink colours (same as eink-theme.css --ink-*) as HSL
INK = {
    "primary": (217, 100.0, 36.7),    # #0047bb blue
    "secondary": (277, 70.0, 35.5),   # #6a1b9a purple
    "success": (148, 100.0, 25.9),    # #00843d green
    "warning": (24, 100.0, 39.2),     # #c85000 orange
    "danger": (350, 85.2, 42.4),      # #c8102e red
}
LEVELS = [round(i * 100 / 15, 2) for i in range(16)]   # the panel's 16 grey levels, in L%


def _snap(lum: float) -> float:
    return min(LEVELS, key=lambda v: abs(v - lum))


def _eink_value(name: str, hsl: str) -> str:
    """Map one HeroUI light token to an e-ink-safe value."""
    try:
        h, s, lum = (float(x.rstrip("%")) for x in hsl.split())
    except ValueError:
        return hsl
    fam = name.split("-")[0]
    shade = name.split("-")[1] if "-" in name else ""
    # surfaces: always white paper
    if name in ("background", "content1", "content2", "content3", "content4", "default-50", "default-100"):
        return "0 0% 100%"
    if name in ("default", "default-200", "default-300"):
        return "0 0% 93.33%"                    # #eee — the only light fill that does not dither
    if name == "divider":
        return "0 0% 20%"
    if name == "focus":
        return "217 100% 36.7%"
    if fam in INK:
        if shade == "foreground":
            return "0 0% 100%"                  # white text ON an ink fill
        if shade and shade.isdigit() and int(shade) <= 300:
            return "0 0% 100%"                  # pale tints dither → white
        ih, isat, il = INK[fam]
        return f"{ih} {isat}% {il}%"
    # everything else (foreground ramp, default-400…900, contentN-foreground): neutral + snapped
    return f"0 0% {_snap(lum)}%"


def heroui_css() -> str:
    for css in sorted(ASSETS.glob("root-*.css")):
        text = css.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"\[data-agent-server-ui\]\s*\.light\s*\{([^{}]*--heroui-[^{}]*)\}", text)
        if not m:
            continue
        pairs = re.findall(r"(--heroui-[a-z0-9-]+):([^;}]+)", m.group(1))
        colour = [(n, v.strip()) for n, v in pairs if re.fullmatch(r"-?[\d.]+ [\d.]+% [\d.]+%", v.strip())]
        other = [(n, v.strip()) for n, v in pairs if (n, v.strip()) not in colour]
        light = ";".join(f"{n}:{v}" for n, v in colour + other)
        eink = ";".join(f"{n}:{_eink_value(n.replace('--heroui-', ''), v)}" for n, v in colour)
        eink += ";--heroui-box-shadow-small:none;--heroui-box-shadow-medium:none;--heroui-box-shadow-large:none"
        return (f"/* generated by patch-ui.py from {css.name} ({len(colour)} HeroUI colour tokens) */\n"
                f"{SCOPE_LIGHT}{{{light}}}\n{SCOPE_EINK}{{{eink}}}\n")
    print("[oh-ui] heroui: no `.light` palette found in root-*.css — HeroUI stays dark-palette", file=sys.stderr)
    return ""


def keep_pause_visible() -> None:
    """The agent-status area (the PAUSE button while the agent runs, the play button when paused) is only
    rendered when the composer row is >= 360 px wide (`showAgentStatusInline = actionsRowWidth >= 360`,
    chat-input-actions.tsx since 1.26). On a phone the row is ~326 px, so the pause button - the last resort
    for stopping a runaway agent - vanished and the new dictation mic stayed (Marc 2026-10-20). Drop the limit:
    the row already measures the right-hand block and drops the model pill / overflow items to fit.
    Idempotent (the minified names change per build, so the pattern reads them); fail-open."""
    try:
        done = 0
        for f in ASSETS.glob("*.js"):
            src = f.read_text(encoding="utf-8")
            new, n = re.subn(r"\b([A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*)>=360,(?=[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\(\{isAcp:)", r"\1>=0,", src)
            if n == 1:
                f.write_text(new, encoding="utf-8")
                print(f"[oh-ui] pause: agent-status no longer hidden below 360 px ({f.name})")
                done += 1
            elif n > 1:
                print(f"[oh-ui] pause: {n} matches in {f.name} - skipping", file=sys.stderr)
        if not done:
            print("[oh-ui] pause: pattern not found (already patched, or the build changed)")
    except Exception as exc:  # never block boot
        print(f"[oh-ui] pause patch failed: {exc}", file=sys.stderr)


def sort_pinned_by_use() -> None:
    """The sidebar's pinned section rendered pins in pin-click order: the store prepends each newly
    pinned id (pinsByBackendId in root-layout-*.js) and the section mapper resolved ids in that order,
    so an often-used old pin sank to the bottom (Marc 2026-10-21). Sort the resolved pinned list by
    updated_at desc instead - the same "latest used" order the chronological list uses. The store keeps
    its pin order (localStorage untouched); only rendering changes. Idempotent; fail-open."""
    try:
        pat = re.compile(
            r"function (?P<fn>[A-Za-z_$][\w$]*)\((?P<pins>[A-Za-z_$][\w$]*),(?P<conns>[A-Za-z_$][\w$]*)\)"
            r"\{let (?P<mp>[A-Za-z_$][\w$]*)=new Map\((?P=conns)\.map\((?P<a>[A-Za-z_$][\w$]*)=>\[(?P=a)\.id,(?P=a)\]\)\);"
            r"return (?P=pins)\.map\((?P<b>[A-Za-z_$][\w$]*)=>(?P=mp)\.get\((?P=b)\)\)"
            r"\.filter\((?P<c>[A-Za-z_$][\w$]*)=>(?P=c)!=null\)\}")
        done = 0
        for f in ASSETS.glob("*.js"):
            src = f.read_text(encoding="utf-8")

            def repl(m):
                fn, pins, conns, mp = (m.group(n) for n in ("fn", "pins", "conns", "mp"))
                # the minifier reuses one identifier for every lambda param, so the sort
                # callback needs its own fresh names (shadowing is harmless here)
                return ("function " + fn + "(" + pins + "," + conns + "){let " + mp
                        + "=new Map(" + conns + ".map(e=>[e.id,e]));"
                        "return " + pins + ".map(e=>" + mp + ".get(e)).filter(e=>e!=null)"
                        ".sort((__pa,__pb)=>(Date.parse(__pb.updated_at??__pb.created_at??0)||0)"
                        "-(Date.parse(__pa.updated_at??__pa.created_at??0)||0))}")

            new, n = pat.subn(repl, src)
            if n == 1:
                f.write_text(new, encoding="utf-8")
                print(f"[oh-ui] pinned-sort: pinned conversations now ordered by last activity ({f.name})")
                done += 1
            elif n > 1:
                print(f"[oh-ui] pinned-sort: {n} matches in {f.name} - skipping", file=sys.stderr)
        if not done:
            print("[oh-ui] pinned-sort: pattern not found (already patched, or the build changed)")
    except Exception as exc:  # never block boot
        print(f"[oh-ui] pinned-sort patch failed: {exc}", file=sys.stderr)


def main() -> int:
    if not INDEX.is_file():
        print(f"[oh-ui] skip: missing {INDEX}", file=sys.stderr)
        return 1
    html = INDEX.read_text(encoding="utf-8")
    html, removed_css = CSS_BLOCK.subn("", html)
    html, removed_js = JS_BLOCK.subn("", html)
    if "</body>" not in html or "</head>" not in html:
        print("[oh-ui] skip: no </head> or </body> anchor", file=sys.stderr)
        return 1

    css_parts, js_parts = [], []
    try:
        gen = heroui_css()
        if gen:
            css_parts.append(gen)
    except Exception as exc:  # never block boot
        print(f"[oh-ui] heroui generation failed: {exc}", file=sys.stderr)
    for name in STYLES:
        p = UI / name
        if p.is_file():
            css = p.read_text(encoding="utf-8")
            if "</style" in css:
                print(f"[oh-ui] skip {name}: contains </style>", file=sys.stderr)
                continue
            css_parts.append(f"/* {name} */\n{css}")
    for name in SCRIPTS:
        p = UI / name
        if p.is_file():
            js = p.read_text(encoding="utf-8")
            if "</script" in js:
                print(f"[oh-ui] skip {name}: contains </script>", file=sys.stderr)
                continue
            js_parts.append(f"/* {name} */\n{js}")

    if css_parts:
        html = html.replace("</head>", f'<style id="{CSS_MARK}">\n' + "\n".join(css_parts) + "\n</style></head>", 1)
    if js_parts:
        html = html.replace("</body>", f'<script id="{JS_MARK}">\n' + "\n".join(js_parts) + "\n</script></body>", 1)
    INDEX.write_text(html, encoding="utf-8")
    keep_pause_visible()
    sort_pinned_by_use()
    print(
        f"[oh-ui] injected {len(css_parts)} stylesheet(s) ({sum(len(c) for c in css_parts)} bytes, replaced={removed_css}) "
        f"+ {len(js_parts)} script(s) ({sum(len(j) for j in js_parts)} bytes JS, replaced={removed_js})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
