#!/usr/bin/env bash
# Host-native OpenHands agent-server = the "Host (mab776)" backend of Agent Canvas (:3003/canvas).
# Runs as mab776 with exactly Claude Code's privileges: full $HOME, docker group, NO passwordless sudo.
# Installed copy lives at /home/mab776/openhands-host/start.sh (see install.sh); env comes from
# /home/mab776/openhands-host/env via the systemd unit.
cd /home/mab776/openhands-host
exec ./.venv/bin/python -m openhands.agent_server --host 0.0.0.0 --port 7300 --import-modules canvas_ui_tool,oh_host_patches
