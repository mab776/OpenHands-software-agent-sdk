#!/bin/bash
# 2026-10-21: automation runs die with "uv: command not found".
# Root cause: the per-run setup.sh is executed by the HOST agent-server via
# /api/bash/start_bash_command -> asyncio.create_subprocess_shell(env=sanitized_env()),
# i.e. a non-interactive /bin/sh -c with the agent-server's system-only PATH
# (~/.bashrc and ~/.profile are never read). uv lives in /home/mab776/.local/bin.
# Patch the shipped setup.sh templates to prepend it to PATH. Idempotent, fail-open.
set -e
for f in /usr/local/lib/python3.13/site-packages/openhands/automation/presets/prompt/setup.sh \
         /usr/local/lib/python3.13/site-packages/openhands/automation/presets/plugin/setup.sh; do
    [ -f "$f" ] || continue
    if grep -q "oh-patch:uv-path" "$f"; then
        echo "[patch-setup] already patched: $f"
        continue
    fi
    # insert right after the first 'set -e' line
    awk '/^set -e$/{print; print "export PATH=\"/home/mab776/.local/bin:$PATH\"  # oh-patch:uv-path"; next}1' "$f" > "$f.ohpatch" && mv "$f.ohpatch" "$f"
    echo "[patch-setup] patched: $f"
done
