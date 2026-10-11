# mab776 fork of the OpenHands software-agent-sdk

Branch **`mab776-1.53.0`** = upstream tag `v1.53.0` — the agent-server version the host-native agent runs
since 2026-10-10 (`~/openhands-host/venv-1.53.0`, paired with Agent Canvas 1.26.0). **No code changes**: the one
fix we carried on `mab776-1.49.1` (orphan tool observation KeyError, upstream #4932) is in upstream since 1.49.5,
so the host's runtime monkeypatch was retired too. This branch exists so a future fix has a home.

Previous: `mab776-1.49.1` (v1.49.1 + cherry-pick of #4932).

To run this fork instead of PyPI:
`pip install "openhands-sdk @ git+https://github.com/mab776/OpenHands-software-agent-sdk@mab776-1.53.0#subdirectory=openhands-sdk"`
(same for the other three packages).

Companion fork: `mab776/OpenHands` (the Agent Canvas UI), branch `mab776-1.26.0`.

Update recipe: `git fetch origin --tags && git checkout -b mab776-<ver> v<ver>`, cherry-pick what upstream
has not merged yet, run `tests/sdk/context/view/`, `git push -u mab776 mab776-<ver>`.
`origin` = upstream (push disabled), `mab776` = this fork.
