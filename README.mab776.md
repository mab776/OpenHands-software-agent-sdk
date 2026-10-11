# mab776 fork of the OpenHands software-agent-sdk

Branch **`mab776-1.49.1`** = upstream tag `v1.49.1` (the `openhands-agent-server` / `-sdk` / `-tools` /
`-workspace` version the host-native agent runs, `~/openhands-host/`) + :

| Commit | What |
|---|---|
| cherry-pick of upstream `dd8d9f6f3` (#4932, in v1.49.5+) | `ToolCallMatchingProperty` tolerates an orphaned tool observation instead of raising `KeyError` on every step (wedged a long conversation 2026-09-22). |

The live install still uses PyPI 1.49.1 + the same fix as a runtime monkeypatch
(`~/Documents/portainer/openhands/host/tools/oh_host_patches.py`). To run this branch instead:
`pip install "openhands-sdk @ git+https://github.com/mab776/OpenHands-software-agent-sdk@mab776-1.49.1#subdirectory=openhands-sdk"`
(same for the other three packages) and drop patch 1 from `oh_host_patches.py`.

Companion fork: `mab776/OpenHands` (the Agent Canvas UI), branch `mab776-1.20.0`.

Update recipe: `git fetch origin --tags && git checkout -b mab776-<ver> v<ver>`, cherry-pick what upstream
has not merged yet, run `tests/sdk/context/view/`, `git push -u mab776 mab776-<ver>`.
`origin` = upstream (push disabled), `mab776` = this fork.
