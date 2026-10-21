#!/usr/bin/env bash
# Cap the canvas' event-websocket reconnect backoff (2026-09-22).
#
# Symptom: from the phone (Hermit Lite / any Android webview) the canvas "always looks stuck" and
# shows "Unable to connect to server [retry]" every time you come back to the app. The server side
# was clean (every request 200, WS accepted). The message comes from the frontend's websocket hook:
# when Android freezes the webview the socket dies; the hook retries with EXPONENTIAL backoff
# 1 s -> 2 -> 4 ... capped at 30 s (`Ue=3e4` in 1.20.0), unlimited attempts, and it has no visibilitychange /
# online listener -- so on resume you sit in up to a 30 s wait staring at the error. 5 s is plenty.
#
# Runs as root at container start, before the entrypoint (same slot as patch-routes.sh). Works on
# whatever hash-named chunk the image ships; idempotent; fail-open (`|| true` in the compose).
set -euo pipefail
# The minified name of the cap changes with every build (1.20.0: Ue, 1.26.0: Ke), so read it from the
# backoff expression itself: Math.min(<base>*2**(<attempts>.current-1),<CAP>).
A=/opt/agent-canvas/frontend/assets
f=$(grep -l 'maxAttempts??1/0' "$A"/*.js 2>/dev/null | head -1 || true)
if [ -z "$f" ]; then echo "[oh-ui] ws: hook not found, skipping"; exit 0; fi
cap=$(grep -oE 'Math\.min\([A-Za-z_$][A-Za-z0-9_$]*\*2\*\*\([A-Za-z_$][A-Za-z0-9_$]*\.current-1\),[A-Za-z_$][A-Za-z0-9_$]*\)' "$f" \
      | head -1 | sed -E 's/.*,([A-Za-z_$][A-Za-z0-9_$]*)\)$/\1/' || true)
if [ -z "$cap" ]; then echo "[oh-ui] ws: backoff expression not found, skipping"; exit 0; fi
if grep -qF "${cap}=5e3" "$f"; then echo "[oh-ui] ws: already patched (${cap}, $(basename "$f"))"; exit 0; fi
n=$(grep -oF "${cap}=3e4" "$f" | wc -l)
if [ "$n" != "1" ]; then echo "[oh-ui] ws: expected exactly one ${cap}=3e4, found $n -- skipping"; exit 0; fi
sed -i "s/\b${cap}=3e4/${cap}=5e3/" "$f"
echo "[oh-ui] ws: max reconnect backoff 30s -> 5s (${cap}) in $(basename "$f")"
