#!/usr/bin/env bash
# Install (or re-install) the HOST-NATIVE OpenHands agent-server as a systemd USER service.
#
#   ./install.sh            # idempotent: keeps an existing key/env, refreshes start.sh + unit, (re)starts
#
# What it gives you: a second backend for the Agent Canvas UI (http://192.168.0.70:3003/canvas) that
# runs on the HOST as mab776 - the same identity and reach Claude Code has (whole $HOME, docker
# group, no passwordless sudo). Pick any folder as a conversation's workspace: ~/Documents/portainer,
# ~/Documents/golf, ...
#
# Marc runs this himself on purpose: it is the step that hands a full-access agent a LAN port.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_DIR=/home/mab776/openhands-host
UNIT_DIR=/home/mab776/.config/systemd/user
UNIT=openhands-agent-server.service
PORT=7300

mkdir -p "$HOST_DIR/state/conversations" "$HOST_DIR/state/bash_events" "$HOST_DIR/tools" "$UNIT_DIR"

# 1. venv with the container's exact pins, one per agent-server version: venv-<ver>, and .venv is a SYMLINK
#    to the active one (start.sh runs .venv/bin/python). Changing the pins in requirements.txt = an upgrade:
#    the new venv is built beside the old one, state is backed up, the symlink flips, the unit restarts.
#    Rollback: restore the old pins, `ln -sfn venv-<old> .venv`, restart the unit.
VER=$(sed -n 's/^openhands-agent-server==//p' "$SRC/requirements.txt")
VENV="$HOST_DIR/venv-$VER"
installed_ver() { "$1/bin/python" -m pip show openhands-agent-server 2>/dev/null | sed -n 's/^Version: //p'; }
if [ -d "$HOST_DIR/.venv" ] && [ ! -L "$HOST_DIR/.venv" ]; then
  # pre-2026-10-10 layout: .venv was a real directory. Keep it as venv-<its version> (run via `python -m`,
  # which survives the rename; only its console-script shebangs go stale).
  OLD=$(installed_ver "$HOST_DIR/.venv"); OLD=${OLD:-old}
  echo "[install] moving the existing .venv (agent-server $OLD) to venv-$OLD"
  mv "$HOST_DIR/.venv" "$HOST_DIR/venv-$OLD"
  ln -sfn "venv-$OLD" "$HOST_DIR/.venv"
fi
if [ "$(installed_ver "$VENV")" != "$VER" ]; then
  echo "[install] creating venv-$VER + installing pins from $SRC/requirements.txt (~2 min)"
  rm -rf "$VENV"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q -r "$SRC/requirements.txt"
fi
CUR=$(readlink "$HOST_DIR/.venv" 2>/dev/null || true)
if [ "$CUR" != "venv-$VER" ]; then
  if [ -n "$CUR" ]; then
    STAMP=$(date +%Y%m%d-%H%M)
    echo "[install] upgrade ${CUR#venv-} -> $VER: backing up state + settings (…bak-$STAMP)"
    cp -a "$HOST_DIR/state" "$HOST_DIR/state.bak-$STAMP"
    [ -d /home/mab776/.openhands ] && cp -a /home/mab776/.openhands "/home/mab776/.openhands.bak-$STAMP"
  fi
  ln -sfn "venv-$VER" "$HOST_DIR/.venv"
fi

# 1b. search MCP server venv (separate: its fastmcp/mcp pins must not touch the agent-server's)
if [ ! -x "$HOST_DIR/mcp-venv/bin/python" ]; then
  echo "[install] creating mcp-venv (SearXNG web_search MCP server)"
  python3 -m venv "$HOST_DIR/mcp-venv"
  "$HOST_DIR/mcp-venv/bin/pip" install -q --upgrade pip
  "$HOST_DIR/mcp-venv/bin/pip" install -q -r "$SRC/mcp/requirements.txt"
fi

# 2. canvas tool module (copied out of the agent-canvas image; keeps FinishTool/canvas_ui registered)
cp "$SRC/tools/canvas_ui_tool.py" "$SRC/tools/oh_host_patches.py" "$HOST_DIR/tools/"

# 3. env: generated ONCE. Delete $HOST_DIR/env to rotate the key (then re-enter it in every browser).
if [ ! -f "$HOST_DIR/env" ]; then
  KEY=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')       # 128-bit, 32 hex chars
  SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')    # settings/secrets cipher
  umask 077
  sed -e "s/__KEY__/$KEY/" -e "s/__SECRET__/$SECRET/" "$SRC/env.template" > "$HOST_DIR/env"
  umask 022
  echo "[install] wrote $HOST_DIR/env (mode 600) with a fresh backend key"
else
  echo "[install] keeping existing $HOST_DIR/env"
fi

# 4. start script + user unit
cp "$SRC/start.sh" "$HOST_DIR/start.sh"; chmod +x "$HOST_DIR/start.sh"
cp "$SRC/$UNIT" "$UNIT_DIR/$UNIT"
systemctl --user daemon-reload
systemctl --user enable "$UNIT" >/dev/null
systemctl --user restart "$UNIT"

# 5. wait for it
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/health" 2>/dev/null && break
  sleep 1
done
if ! curl -fsS -o /dev/null "http://127.0.0.1:$PORT/health"; then
  echo "[install] agent-server did not come up - journalctl --user -u $UNIT -n 50" >&2
  exit 1
fi

# 6. seed the LLM profiles + ASK-by-default + web search — FIRST INSTALL ONLY. Re-seeding later would re-add
#    `default` beside the profiles Marc renamed in the UI (Qwen / Qwen-a / DeepSeek) and switch the active
#    model back. Force it with OH_RESEED=1 (or run seed-settings.sh by hand).
KEY0=$(sed -n 's/^OH_SESSION_API_KEYS_0=//p' "$HOST_DIR/env")
NPROF=$(curl -s -H "X-Session-API-Key: $KEY0" "http://127.0.0.1:$PORT/api/profiles" \
        | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("profiles",[])))' 2>/dev/null || echo 0)
if [ "$NPROF" = "0" ] || [ "${OH_RESEED:-0}" = "1" ]; then
  "$SRC/seed-settings.sh"
else
  echo "[install] $NPROF LLM profile(s) already saved - not re-seeding (OH_RESEED=1 to force)"
fi
echo "[install] agent-server $(curl -s "http://127.0.0.1:$PORT/server_info" | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])')"

KEY=$(sed -n 's/^OH_SESSION_API_KEYS_0=//p' "$HOST_DIR/env")
cat <<EOF

[install] DONE. Host backend is up: http://192.168.0.70:$PORT  (systemd --user unit: $UNIT)

Add it ONCE per browser (desktop + phone) in the Agent Canvas UI:
  http://192.168.0.70:3003/canvas  ->  backend picker  ->  Manage Backends  ->  Add
    Name:     Host (mab776)
    URL:      http://192.168.0.70:$PORT
    API key:  $KEY

Then pick "Host (mab776)" as the active backend and start a conversation with the workspace set to
the folder you want (e.g. /home/mab776/Documents/portainer or /home/mab776/Documents/golf).
EOF
