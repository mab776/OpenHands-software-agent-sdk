#!/usr/bin/env bash
# Seed the HOST backend's settings the way the container backend is configured (idempotent):
#   - LLM profile "default" -> the Normal coder on :8319 (the host can't resolve the Docker alias)
#   - conversation defaults: confirmation_mode ON + the llm security analyzer = ASK mode by default
# Reads the key from /home/mab776/openhands-host/env. Called by install.sh; safe to re-run.
set -euo pipefail
ENV_FILE=${OH_ENV_FILE:-/home/mab776/openhands-host/env}
BASE=${OH_HOST_BASE:-http://127.0.0.1:7300}
KEY=$(sed -n 's/^OH_SESSION_API_KEYS_0=//p' "$ENV_FILE")
[ -n "$KEY" ] || { echo "no OH_SESSION_API_KEYS_0 in $ENV_FILE" >&2; exit 1; }
H=(-H "X-Session-API-Key: $KEY" -H "Content-Type: application/json")

# Overridable for tests (e.g. point at ollama while the coder stack is stopped).
MODEL=${OH_SEED_MODEL:-openai/qwen3.8-flash-next-iq3}
BASE_URL=${OH_SEED_BASE_URL:-http://192.168.0.70:8319/v1}
EFFORT=${OH_SEED_EFFORT:-medium}   # 10-19: medium = the middle of the "+" menu's Low/Medium/High (host patch 3 makes it real)
# max_input_tokens = the model's context window. Without it litellm reports context_window 0 for a custom
# model and the UI's context meter (the ring next to Send → "Context Window") says "window size unknown".
# 262144 = both model ids stack 67 (Strata) serves; GET /v1/models reports n_ctx 262144 for each.
# capability_overrides.supports_vision: litellm knows nothing about a custom `openai/…` model, so OpenHands
# resolved vision_is_active()=False → the file editor never offered to `view` images and images were
# stripped before reaching the model ("I can't load pictures from the disk", 2026-09-28). Both Qwen Next
# stacks on :8319 load the mmproj (llama-server /props → modalities.vision=true), so force it on.
CTX=${OH_SEED_CTX:-262144}
llm_json(){ python3 -c '
import json,sys
print(json.dumps({"model":sys.argv[1],"base_url":sys.argv[2],"api_key":"local",
  "reasoning_effort":sys.argv[3],"native_tool_calling":True,"max_input_tokens":int(sys.argv[4]),
  "capability_overrides":{"supports_vision":True}}))' "$1" "$BASE_URL" "$EFFORT" "$CTX"; }
LLM=$(llm_json "$MODEL")

code=$(curl -s -o /tmp/oh-seed.out -w '%{http_code}' "${H[@]}" -X POST "$BASE/api/profiles/default" -d "{\"llm\":$LLM,\"include_secrets\":true}")
echo "[seed] save profile default -> $code"
code=$(curl -s -o /tmp/oh-seed.out -w '%{http_code}' "${H[@]}" -X POST "$BASE/api/profiles/default/activate")
echo "[seed] activate profile default -> $code"
code=$(curl -s -o /tmp/oh-seed.out -w '%{http_code}' "${H[@]}" -X PATCH "$BASE/api/settings" \
  -d "{\"agent_settings_diff\":{\"llm\":$LLM},\"conversation_settings_diff\":{\"confirmation_mode\":true,\"security_analyzer\":\"llm\"}}")
echo "[seed] patch settings (llm + ASK by default) -> $code"

# ⭐ The ABLITERATED twin as a second saved LLM profile (2026-10-06). Strata serves a second model id,
# `qwen3.8-flash-next-iq3-abliterated` (config `abliterated_model_name`), always abliterated regardless of
# the mode page's shared `experimental_speed_projection` setting — so unlike the mode page toggle this does
# not change the OTHER id's behaviour. A saved LLM profile is what the composer's model dropdown lists
# (`chat-input-llm-profile-option-*`) and what POST /api/conversations/{id}/switch_profile consumes, so
# adding it here = it shows up in the UI and mid-conversation switches work. Save it AFTER the settings
# PATCH above: activating a profile rewrites agent_settings.llm, so this one is only saved, never activated.
ABLIT_MODEL=${OH_SEED_ABLIT_MODEL:-openai/qwen3.8-flash-next-iq3-abliterated}
ABLIT=$(llm_json "$ABLIT_MODEL")
code=$(curl -s -o /tmp/oh-seed.out -w '%{http_code}' "${H[@]}" -X POST "$BASE/api/profiles/$ABLIT_MODEL" -d "{\"llm\":$ABLIT,\"include_secrets\":true}")
echo "[seed] save profile $ABLIT_MODEL (always-abliterated) -> $code"

# Qwen side-load profiles REMOVED 2026-10-21 (Marc): stack 76 answers on the SAME :8319 + model ids as
# stack 67, so Qwen-sideload / Qwen-sideload-a were exact duplicates of Qwen / Qwen-a.

# DeepSeek-V4-Flash (2026-10-10) as a third saved LLM profile: the DeepSeek stacks on :8330 - llama.cpp stack 73 or
# our Strata-DS4 stack 74 (same port + model id; the mode page's DeepSeek tile picks the engine, nothing to change
# here). Text only (supports_vision False: an image would be refused by the server), 262,144 context, thinking
# "high" (the server maps it: none -> off, low/medium -> on, high/xhigh -> high, max -> max). Saved, not activated -
# pick it in the composer's model dropdown (or switch a conversation to it) when a DeepSeek mode is running.
DS_MODEL=${OH_SEED_DS_MODEL:-openai/deepseek-v4-flash}
DS_NAME=${OH_SEED_DS_NAME:-DeepSeek}   # a profile name with a "/" 404s (the route takes one path segment)
DS=$(python3 -c '
import json,sys
print(json.dumps({"model":sys.argv[1],"base_url":"http://192.168.0.70:8330/v1","api_key":"local",
  "reasoning_effort":"medium","native_tool_calling":True,"max_input_tokens":262144,
  "capability_overrides":{"supports_vision":False}}))' "$DS_MODEL")
code=$(curl -s -o /tmp/oh-seed.out -w '%{http_code}' "${H[@]}" -X POST "$BASE/api/profiles/$DS_NAME" -d "{\"llm\":$DS,\"include_secrets\":true}")
echo "[seed] save profile $DS_NAME ($DS_MODEL @ :8330) -> $code"
# DeepSeek V4.1 exact routing (2026-10-19): the same endpoint under the alias deepseek-v4-flash-exact - stack 78 (V4.1)
# routes that request's experts exactly (no 0.5 / 0.3 speed bias: better quality, slower decode); V4 (stack 74) serves the
# name as its plain model
DSX=$(echo "$DS" | sed "s#\"$DS_MODEL\"#\"${DS_MODEL}-exact\"#")
code=$(curl -s -o /tmp/oh-seed.out -w '%{http_code}' "${H[@]}" -X POST "$BASE/api/profiles/${DS_NAME}-exact" -d "{\"llm\":$DSX,\"include_secrets\":true}")
echo "[seed] save profile ${DS_NAME}-exact (${DS_MODEL}-exact @ :8330) -> $code"

# web search: the SAME tool Open WebUI uses (open-webui/tools/web_search_v0.3.0.py) behind an MCP server
# (mcp/searxng_search_mcp.py, own venv) → the agent gets `web_search` + `fetch_page` tools. (2026-09-28)
MCP='{"searxng":{"transport":"stdio","command":"/home/mab776/openhands-host/mcp-venv/bin/python","args":["/home/mab776/Documents/portainer/openhands/host/mcp/searxng_search_mcp.py"],"description":"Web search via Marc'"'"'s SearXNG + page reader (same tool as Open WebUI)"}}'
code=$(curl -s -o /tmp/oh-seed.out -w '%{http_code}' "${H[@]}" -X PATCH "$BASE/api/settings" -d "{\"agent_settings_diff\":{\"mcp_config\":$MCP}}")
echo "[seed] mcp: searxng web_search -> $code"

curl -s "${H[@]}" "$BASE/api/settings" | python3 -c '
import sys,json; d=json.load(sys.stdin)
print("[seed] model:", d["agent_settings"]["llm"]["model"], "@", d["agent_settings"]["llm"]["base_url"])
print("[seed] confirmation_mode:", d["conversation_settings"]["confirmation_mode"], "analyzer:", d["conversation_settings"]["security_analyzer"])
print("[seed] active_agent_profile_id:", d.get("active_agent_profile_id"))
print("[seed] mcp servers:", list((d["agent_settings"].get("mcp_config") or {}).keys()))'
curl -s "${H[@]}" "$BASE/api/profiles" | python3 -c '
import sys,json; d=json.load(sys.stdin)
for p in d["profiles"]:
    print("[seed] llm profile:", p["name"], "->", p["model"], "@", p["base_url"])
print("[seed] active llm profile:", d.get("active_profile"))'
rm -f /tmp/oh-seed.out
