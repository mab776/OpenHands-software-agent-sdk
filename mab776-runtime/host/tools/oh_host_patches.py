"""Host-side hotfixes for the OpenHands SDK, loaded via `--import-modules` (see start.sh).

Keep this file tiny and every patch dated + justified; delete a patch once the pinned SDK ships the fix.

Active: 2. event search limited to the active branch (2026-10-19, in-place "edit my last message"); 3. reasoning effort
sent to the local coders via extra_body (2026-10-19, the "+" menu Thinking list); 4. workspace-preview cookie usable
over plain http (2026-10-21, Files-tab previews 401'd on http://192.168.0.70:3003). See below.

Retired:

1. ToolCallMatchingProperty.manipulation_indices KeyError on an orphan observation (2026-09-22, SDK 1.49.1):
   wedged a long AUTO-mode conversation on every condensation step. Upstream fixed it the same way
   (`discard` instead of `remove`) in #4932, shipped in 1.49.5; retired with the move to 1.53.0. The old
   monkeypatch is in git history / tools/oh_host_patches.py.bak-20261010.
"""

import logging

_log = logging.getLogger("oh_host_patches")


# 2. (2026-10-19) "Edit my last message" in place: the canvas add-on ui/edit-last.js moves the conversation's
#    HEAD back to the message's parent (POST /api/conversations/{id}/navigate, in the SDK since 1.4x; the agent
#    then only sees the active branch). But EventService's search - used by the REST history AND the websocket
#    resend on connect - lists EVERY event on disk, so the edited-away message and its answers stayed on screen.
#    Here: events off the active branch (path_to_root(HEAD)) are skipped. Non-tree artifacts
#    (ConversationStateUpdateEvent) are always kept; an error event is kept only if its parent is on the branch.
#    Cost: one walk of the branch per (HEAD, length) change, events come from the EventLog's cache.
#    Version-agnostic (1.49.1 live, 1.54.0 after the cutover): it wraps EventService._get_searchable_event.
try:
    from openhands.agent_server.event_service import EventService as _ES
    from openhands.sdk.event.conversation_state import ConversationStateUpdateEvent as _CSU

    _orig_get_searchable = _ES._get_searchable_event

    def _active_ids(self, events):
        st = self._conversation._state
        leaf = st._resolve_active_leaf()
        key = (leaf, len(events))
        cache = getattr(self, "_oh_branch_cache", None)
        if cache and cache[0] == key:
            return cache[1]
        ids = {e.id for e in events.path_to_root(leaf)} if leaf is not None else set()
        self._oh_branch_cache = (key, ids)
        return ids

    def _branch_searchable_event(self, events, index):
        event = _orig_get_searchable(self, events, index)
        if event is None or isinstance(event, _CSU):
            return event
        try:
            ids = _active_ids(self, events)
        except Exception:  # never hide history because of this patch
            _log.exception("oh_host_patches: active-branch filter failed; showing everything")
            return event
        if event.id in ids:
            return event
        parent = getattr(event, "parent_id", None)
        # an off-tree event (error/artifact appended without becoming HEAD) belongs to the branch it hangs on
        if type(event).__name__ == "ConversationErrorEvent" and (parent is None or parent in ids):
            return event
        return None

    _ES._get_searchable_event = _branch_searchable_event
    _log.info("oh_host_patches: event search limited to the active branch (in-place message edit)")
except Exception:
    _log.exception("oh_host_patches: patch 2 failed to apply")


# 3. (2026-10-19) Reasoning effort that actually reaches OUR coders (the "+" menu's 🧠 Thinking list, ui/effort-menu.js).
#    Two SDK/litellm behaviours ate it: the SDK only adds `reasoning_effort` for models litellm knows as reasoning
#    models (not openai/qwen3.8-flash-next-iq3...), and even when it does (openai/deepseek-v4-flash), litellm's
#    drop_params removed it before the request left (checked with a capture server: reasoning_effort None). So every
#    profile's "high" was ignored and each server ran its own default. Here: for a coder on THIS box (192.168.0.70 /
#    10.229.135.70 / localhost / llm-router), the effort is sent in extra_body (litellm passes that through verbatim).
#    low / medium / high = three distinct tiers on every coder, the same table as llm-router's AUTO_EFFORT:
#      Qwen Strata + DeepSeek V4.1: as is;  DeepSeek V4 (no low): low->medium, medium->high, high->max.
#    V4 vs V4.1 (same :8330, same id) = the mode page's ds_variant, cached 30 s. Other values (max, none...) pass as is.
try:
    import json as _json
    import time as _time
    import urllib.parse as _up
    import urllib.request as _ur
    from openhands.sdk.llm import llm as _llm_mod

    _orig_select_chat = _llm_mod.select_chat_options
    _LOCAL_HOSTS = {"192.168.0.70", "10.229.135.70", "127.0.0.1", "localhost", "llm-router"}
    _V4 = {"low": "medium", "medium": "high", "high": "max"}
    _ds_cache = [0.0, None]

    def _ds_variant():
        if _time.monotonic() - _ds_cache[0] > 30:
            try:
                with _ur.urlopen("http://192.168.0.70:8500/api/status", timeout=2) as r:
                    _ds_cache[1] = _json.load(r).get("ds_variant")
            except Exception:
                pass  # keep the last known value
            _ds_cache[0] = _time.monotonic()
        return _ds_cache[1]

    def _wire_effort(llm, effort):
        if "deepseek" in (llm.model or "").lower() and _ds_variant() != "v41":
            return _V4.get(effort, effort)
        return effort

    def _effort_select_chat_options(llm, *args, **kwargs):
        out = _orig_select_chat(llm, *args, **kwargs)
        try:
            effort = llm.reasoning_effort
            host = _up.urlsplit(llm.base_url or "").hostname
            if isinstance(effort, str) and effort and host in _LOCAL_HOSTS:
                out.pop("reasoning_effort", None)
                body = dict(out.get("extra_body") or {})
                body["reasoning_effort"] = _wire_effort(llm, effort.strip().lower())
                out["extra_body"] = body
        except Exception:
            _log.exception("oh_host_patches: effort patch failed for one call; sent without it")
        return out

    _llm_mod.select_chat_options = _effort_select_chat_options
    _log.info("oh_host_patches: reasoning effort sent to the local coders (extra_body, V4 tiers mapped)")
except Exception:
    _log.exception("oh_host_patches: patch 3 failed to apply")


# 4. (2026-10-21) File previews (Files tab images/PDFs/HTML) were broken — every
#    /api/conversations/{id}/workspace/... request answered 401 on http://192.168.0.70:3003 (and on phones pointed
#    at the host backend directly). Cause: the workspace static routes authenticate with the oh_workspace_session_key
#    cookie (<img>/<iframe> cannot send X-Session-API-Key), and auth_router mints it SameSite=None; Secure — Secure
#    only where the browser sees a secure context (https or loopback; 192.168.0.70 is NOT loopback). Chrome then
#    DROPS the cookie over plain http (SameSite=None requires Secure) → nothing authenticates the image → broken preview.
#    (HTTPS :8446 was never affected; verified live both ways with Playwright.)
#    Here: mint SameSite=Lax (no Secure) when the request is not a secure context — a plain-http page can then store
#    and send the cookie for these same-site, same-port requests; top-level navigations still send Lax. Secure
#    contexts keep the original None;Secure;Partitioned cookie. The cookie only ever reaches the workspace router,
#    and the server is LAN/WG-only, so the Lax downgrade is a local-network trade-off, not an exposure.
try:
    from openhands.agent_server import auth_router as _auth_router

    _orig_set_cookie = _auth_router._set_workspace_cookie

    def _set_workspace_cookie_lax(response, *, value, secure, max_age):
        if not secure:
            _orig_set_cookie(response, value=value, secure=False, max_age=max_age)
            raw = response.raw_headers
            for idx in range(len(raw) - 1, -1, -1):
                name, val = raw[idx]
                if name.lower() == b"set-cookie" and val.startswith(
                    _auth_router.WORKSPACE_SESSION_COOKIE_NAME.encode("latin-1") + b"="
                ):
                    raw[idx] = (name, val.replace(b"SameSite=none", b"SameSite=lax"))
                    break
            return
        _orig_set_cookie(response, value=value, secure=secure, max_age=max_age)

    _auth_router._set_workspace_cookie = _set_workspace_cookie_lax
    _log.info("oh_host_patches: workspace cookie mints SameSite=Lax on plain http (file previews)")
except Exception:
    _log.exception("oh_host_patches: patch 4 failed to apply")
