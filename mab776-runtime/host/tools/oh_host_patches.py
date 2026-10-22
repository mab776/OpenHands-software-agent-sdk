"""Host-side hotfixes for the OpenHands SDK, loaded via `--import-modules` (see start.sh).

Keep this file tiny and every patch dated + justified; delete a patch once the pinned SDK ships the fix.

Active: 2. event search limited to the active branch (2026-10-19, in-place "edit my last message"); 3. reasoning effort
sent to the local coders via extra_body (2026-10-19, the "+" menu Thinking list); 4. workspace-preview cookie usable
over plain http (2026-10-21, Files-tab previews 401'd on http://192.168.0.70:3003); 5. workspace preview falls back
to the absolute path (2026-10-21, out-of-workspace files like /tmp/*.jpg 404'd); 6. a message typed while the model
is answering goes AFTER that answer in the next prompt (2026-10-22, it rewrote history the model had already read = the
engine re-read the whole 166k conversation); 7. the condenser follows a profile switch (2026-10-22, it kept calling the
stopped Qwen on :8319 = ~2 min of retries every DeepSeek turn). See below.

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


# 5. (2026-10-21) Previews of files OUTSIDE the conversation workspace (e.g. an image the agent read from /tmp)
#    still 404'd even with a valid cookie. The Files tab builds the <img> src by stripping the leading slash off the
#    absolute path (frontend W(): "/tmp/x.jpg" -> "tmp/x.jpg"), and workspace_router resolves that relative to the
#    workspace dir -> golf/tmp/x.jpg -> 404 "File not found" (journalctl: GET .../workspace/tmp/sheet_A_turbo_only.jpg
#    404). Here: when the workspace-relative lookup 404s, retry the same remainder as an absolute path. No privilege
#    added: the cookie is only minted to clients that already hold the session key, which can read any absolute path
#    through /api/file/download anyway — this just makes the <img> path match that existing access.
try:
    from openhands.agent_server import workspace_router as _wr

    _orig_serve_path = _wr._serve_path

    def _serve_path_abs_fallback(workspace_dir, file_path):
        try:
            return _orig_serve_path(workspace_dir, file_path)
        except Exception as exc:
            detail = getattr(exc, "detail", "")
            if detail != "File not found" or not file_path:
                raise
            absolute = _wr.Path("/") / file_path
            if absolute.is_file():
                return _wr.FileResponse(path=absolute)
            raise

    _wr._serve_path = _serve_path_abs_fallback
    _log.info("oh_host_patches: workspace preview falls back to the absolute path (out-of-workspace files)")
except Exception:
    _log.exception("oh_host_patches: patch 5 failed to apply")


# 6. (2026-10-22) A message typed WHILE the model is answering. The SDK appends events in arrival order, so the next
#    prompt read [tool results, YOUR MESSAGE, the model's reply, ...] - the reply claims to have seen a message it never
#    saw, and the prompt the model already read changed 3 tokens from its end (DeepSeek V4.1's template folds the
#    message into the tool-result turn: "</tool_result>" -> "</tool_result>\n\n..."). Stack 78's prompt cache only
#    reuses an exact prefix, so each such turn re-read the WHOLE conversation: 165,986 tokens in 93 s instead of ~13 s
#    (engine log 15:18 + 15:22, conversation 7f819af5). Here: every LLM request records the last event it included
#    (llm_response_id -> that event id, also appended to state/llm_context_ends.jsonl so it survives a restart), and the
#    projection to messages moves user messages that landed between that event and the reply to after the reply and its
#    tool results - the order the model actually lived. Only replies made with this patch loaded are touched (older
#    history renders exactly as before = no cache bust on upgrade); anything unusual (another kind of event in between,
#    a tool call without its result yet, the request's last event condensed away) keeps the stored order.
try:
    import contextvars as _cv
    import json as _json
    import os as _os
    import threading as _threading

    from openhands.sdk.agent import agent as _agent_mod
    from openhands.sdk.event.base import LLMConvertibleEvent as _LCE
    from openhands.sdk.event.llm_convertible import ActionEvent as _AE
    from openhands.sdk.event.llm_convertible import MessageEvent as _ME
    from openhands.sdk.event.llm_convertible import ObservationBaseEvent as _OBE

    _ctx_path = _os.path.join(
        _os.path.dirname(_os.environ.get("OH_CONVERSATIONS_PATH", "/home/mab776/openhands-host/state/conversations")),
        "llm_context_ends.jsonl",
    )
    _ctx_ends: dict = {}  # llm_response_id -> id of the last event its request included
    _ctx_lock = _threading.Lock()
    _ctx_now: _cv.ContextVar = _cv.ContextVar("oh_ctx_end", default=None)
    try:
        with open(_ctx_path) as _f:
            for _line in _f:
                try:
                    _r = _json.loads(_line)
                    _ctx_ends[_r["r"]] = _r["e"]
                except Exception:
                    pass
    except FileNotFoundError:
        pass

    def _note_view(view, result):
        if isinstance(result, list):
            evs = getattr(view, "events", None)
            if evs:
                _ctx_now.set(evs[-1].id)

    _orig_prepare = _agent_mod.prepare_llm_messages
    _orig_aprepare = _agent_mod.aprepare_llm_messages

    def _prepare(view, *a, **k):
        result = _orig_prepare(view, *a, **k)
        _note_view(view, result)
        return result

    async def _aprepare(view, *a, **k):
        result = await _orig_aprepare(view, *a, **k)
        _note_view(view, result)
        return result

    _agent_mod.prepare_llm_messages = _prepare
    _agent_mod.aprepare_llm_messages = _aprepare

    def _record(events, n0, ctx_end):
        new = []
        with _ctx_lock:
            for i in range(n0, len(events)):
                e = events[i]
                rid = getattr(e, "llm_response_id", None)
                if rid and getattr(e, "source", None) == "agent" and rid not in _ctx_ends:
                    _ctx_ends[rid] = ctx_end
                    new.append({"r": rid, "e": ctx_end})
            if new:
                try:
                    with open(_ctx_path, "a") as f:
                        f.writelines(_json.dumps(r) + "\n" for r in new)
                except Exception:
                    _log.exception("oh_host_patches: could not save the request ends (kept in memory)")

    _orig_step = _agent_mod.Agent._step
    _orig_astep = _agent_mod.Agent._astep

    def _step(self, conversation, on_event, stream):
        token = _ctx_now.set(None)
        events = conversation.state.events
        n0 = len(events)
        try:
            return _orig_step(self, conversation, on_event, stream)
        finally:
            ctx_end = _ctx_now.get()
            _ctx_now.reset(token)
            if ctx_end:
                _record(events, n0, ctx_end)

    async def _astep(self, conversation, on_event, stream):
        token = _ctx_now.set(None)
        events = conversation.state.events
        n0 = len(events)
        try:
            return await _orig_astep(self, conversation, on_event, stream)
        finally:
            ctx_end = _ctx_now.get()
            _ctx_now.reset(token)
            if ctx_end:
                _record(events, n0, ctx_end)

    _agent_mod.Agent._step = _step
    _agent_mod.Agent._astep = _astep

    def _is_reply(e):
        return isinstance(e, (_AE, _ME)) and e.source == "agent" and getattr(e, "llm_response_id", None)

    def _causal_order(events):
        out = list(events)
        i = 0
        while i < len(out):
            e = out[i]
            ctx_end = _ctx_ends.get(e.llm_response_id) if _is_reply(e) else None
            if ctx_end is None:
                i += 1
                continue
            c = next((n for n in range(i - 1, -1, -1) if out[n].id == ctx_end), None)
            late = out[c + 1 : i] if c is not None else []
            if not late or not all(isinstance(x, _ME) and x.source == "user" for x in late):
                i += 1
                continue
            rid = e.llm_response_id
            j = i
            while j < len(out) and _is_reply(out[j]) and out[j].llm_response_id == rid:
                j += 1
            calls = {x.tool_call_id for x in out[i:j] if isinstance(x, _AE)}
            k = j
            while k < len(out) and calls and isinstance(out[k], _OBE) and out[k].tool_call_id in calls:
                k += 1
            if calls - {x.tool_call_id for x in out[j:k]}:
                i = j  # a tool call still waits for its result: keep the stored order
                continue
            out[c + 1 : k] = out[i:k] + late
            i = k
        return out

    _orig_e2m = _LCE.events_to_messages

    def _events_to_messages(events):
        try:
            if _ctx_ends:
                events = _causal_order(events)
        except Exception:
            _log.exception("oh_host_patches: causal reorder failed; stored order used")
        return _orig_e2m(events)

    _LCE.events_to_messages = staticmethod(_events_to_messages)
    _log.info("oh_host_patches: messages typed mid-answer follow that answer (%d request ends loaded)", len(_ctx_ends))
except Exception:
    _log.exception("oh_host_patches: patch 6 failed to apply")


# 7. (2026-10-22) The condenser follows a profile switch. LocalConversation._condenser_for_switched_llm moves the
#    summarizing condenser to the new model ONLY when its LLM config equals the old agent LLM's byte for byte; ours
#    differed, so conversation 7f819af5 (started on Qwen, switched to DeepSeek) kept a condenser on :8319 with Qwen
#    stopped. Past condenser.max_size (240 events) every step tried to condense: 5 connection-refused attempts with
#    8-64 s back-off (~2 min, journalctl "Connection error.. Attempt #4") before the DeepSeek call even started.
#    We never configure a separate condenser model (Settings -> Condenser has none; build_condenser copies the agent
#    LLM), so it always follows the agent's LLM, keeping its own usage_id.
try:
    from openhands.sdk.context.condenser import LLMSummarizingCondenser as _LSC
    from openhands.sdk.conversation.impl.local_conversation import LocalConversation as _LC

    def _condenser_follows(self, current_llm, new_llm):
        condenser = self.agent.condenser
        if not isinstance(condenser, _LSC):
            return condenser
        condenser_llm = new_llm.model_copy(update={"usage_id": condenser.llm.usage_id})
        condenser_llm.reset_metrics()
        return condenser.model_copy(update={"llm": condenser_llm})

    _LC._condenser_for_switched_llm = _condenser_follows
    _log.info("oh_host_patches: the condenser follows a profile switch")
except Exception:
    _log.exception("oh_host_patches: patch 7 failed to apply")
