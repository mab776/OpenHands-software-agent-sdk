# mab776 fork of the OpenHands software-agent-sdk

Branch **`mab776-1.54.0`** = upstream tag `v1.54.0` — the agent-server version the host-native agent runs
since 2026-10-12 (`~/openhands-host/venv-1.54.0`, paired with Agent Canvas 1.27.1). **No code changes**: the one
fix we carried on `mab776-1.49.1` (orphan tool observation KeyError, upstream #4932) is in upstream since 1.49.5,
so the host's runtime monkeypatch was retired too. This branch exists so a future fix has a home.

Previous: `mab776-1.53.0` (never deployed), `mab776-1.49.1` (v1.49.1 + cherry-pick of #4932).

To run this fork instead of PyPI:
`pip install "openhands-sdk @ git+https://github.com/mab776/OpenHands-software-agent-sdk@mab776-1.54.0#subdirectory=openhands-sdk"`
(same for the other three packages).

Companion fork: `mab776/OpenHands` (the Agent Canvas UI), branch `mab776-1.27.1`.

`mab776-runtime/` (since 2026-10-21): backup copy of the runtime kit — the patches applied at start to
the stock canvas image (`ui/`) and the stock PyPI agent-server (`host/`, incl. `oh_host_patches.py`
runtime patches 1–4). Source of truth stays on the server; push a refreshed copy when they change.

Update recipe: `git fetch origin --tags && git checkout -b mab776-<ver> v<ver>`, cherry-pick what upstream
has not merged yet, run `tests/sdk/context/view/`, `git push -u mab776 mab776-<ver>`.
`origin` = upstream (push disabled), `mab776` = this fork.
