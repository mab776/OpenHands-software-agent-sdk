#!/usr/bin/env bash
# Make the HOST-NATIVE agent-server the canvas' DEFAULT backend (2026-09-21).
#
# The shipped entrypoint hardcodes every agent-server route of the static server to the in-container
# server (http://127.0.0.1:${AGENT_SERVER_PORT}). This rewrites those nine `--route` lines so they
# honour $CANVAS_BACKEND_URL when it is set (compose sets it to http://192.168.0.70:7300) and keep the
# original fallback when it is not. The automation route (AUTOMATION_PORT) and the editor route
# (VSCODE_ROUTE) are untouched. Runs as root at container start, before the entrypoint; idempotent
# (the pattern no longer matches once rewritten) and fail-open (`|| true` in the compose entrypoint).
#
# Net effect: the browser's default "Local" backend IS the host, with the key the page already bakes
# in (the host server accepts that key as OH_SESSION_API_KEYS_1). No Manage Backends, no per-browser
# key, no CORS dependency. The in-container agent-server still starts on :18000 but nothing routes to
# it; the sandbox is effectively retired (Marc's call: full access, "drop the local test").
set -euo pipefail
EP=/opt/agent-canvas/entrypoint.sh
if grep -q 'CANVAS_BACKEND_URL' "$EP"; then
  echo "[oh-ui] routes already patched"
  exit 0
fi
n=$(grep -c -- '--route "/[a-z_.]*=http://127.0.0.1:${AGENT_SERVER_PORT}"' "$EP" || true)
sed -i -E 's#(--route "/[a-z_.]+=)http://127\.0\.0\.1:\$\{AGENT_SERVER_PORT\}"#\1${CANVAS_BACKEND_URL:-http://127.0.0.1:${AGENT_SERVER_PORT}}"#' "$EP"
echo "[oh-ui] routed $n agent-server routes to \${CANVAS_BACKEND_URL:-in-container}"
