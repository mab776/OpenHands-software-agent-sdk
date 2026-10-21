#!/usr/bin/env python3
"""SearXNG web search for OpenHands, as an MCP server (stdio) — 2026-09-28.

Marc: "proper fix please, it works well in openwebui". So this does NOT reimplement search: it loads
the SAME tool file Open WebUI uses (open-webui/tools/web_search_v0.3.0.py — operator stripping,
zero-result retry ladder, domain dedupe, relevance guard, trafilatura page extraction) and exposes its
two functions as MCP tools. One source of truth; fix it there and both apps get the fix.

Tools:
  web_search(query)   SearXNG → top results scraped to clean text (JSON list of {title,url,content,snippet})
  fetch_page(url)     one URL → clean main text (JSON list with one {title,url,content})

Runs in its own venv (~/openhands-host/mcp-venv) so the agent-server's pinned libraries are untouched.
Registered in the host backend's agent_settings.mcp_config by openhands/host/seed-settings.sh.
Env overrides: OH_SEARXNG_URL (default http://192.168.0.70:8090/search — the host can't resolve the
Docker name `searxng`), OH_SEARCH_TOOL_FILE, OH_SEARCH_PAGES (pages returned per search, default 3),
OH_SEARCH_WORDS (words kept per page, default 800).
"""
import importlib.util
import os
import sys

from fastmcp import FastMCP

TOOL_FILE = os.environ.get(
    "OH_SEARCH_TOOL_FILE",
    "/home/mab776/Documents/portainer/open-webui/tools/web_search_v0.3.0.py",
)
spec = importlib.util.spec_from_file_location("owui_web_search", TOOL_FILE)
owui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owui)

tools = owui.Tools()
tools.valves.SEARXNG_ENGINE_API_BASE_URL = os.environ.get("OH_SEARXNG_URL", "http://192.168.0.70:8090/search")
tools.valves.RETURNED_SCRAPPED_PAGES_NO = int(os.environ.get("OH_SEARCH_PAGES", "3"))
tools.valves.PAGE_CONTENT_WORDS_LIMIT = int(os.environ.get("OH_SEARCH_WORDS", "800"))

mcp = FastMCP("searxng")


@mcp.tool
async def web_search(query: str) -> str:
    """Search the web (Marc's own SearXNG) and return the cleaned text of the top relevant pages.

    Use this for anything current or outside your knowledge: releases, versions, docs, issues, model
    cards, prices, news. Prefer it over hand-written curl/python scraping.
    Query tips for this SearXNG: plain keywords work best; quotes, OR/AND and -minus return ZERO
    results (the tool strips them and retries automatically, then says so if still empty). Run several
    short queries rather than one clever one. Returns JSON: [{title, url, content, snippet}].
    """
    return await tools.search_web(query)


@mcp.tool
async def fetch_page(url: str) -> str:
    """Fetch one web page and return its cleaned main text (no scripts/nav/ads).

    Use after web_search to read a result in full, or when you already have the URL.
    Returns JSON: [{title, url, content}].
    """
    return await tools.get_website(url)


if __name__ == "__main__":
    print(f"[searxng-mcp] tool file {TOOL_FILE}, SearXNG {tools.valves.SEARXNG_ENGINE_API_BASE_URL}", file=sys.stderr)
    mcp.run()  # stdio
