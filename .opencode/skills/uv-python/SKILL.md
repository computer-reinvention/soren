---
name: uv-python
description: Python dependency and execution workflows with uv - the only sanctioned way to run Python in this system.
---

# uv (Python toolchain)

All Python here runs through uv. Never call `pip`, never activate venvs
manually, never `python3 script.py` against repo code.

## Daily commands

```bash
uv sync                          # install from pyproject.toml + uv.lock
uv sync --extra dev              # include dev deps (pytest lives here)
uv run pytest                    # run tests in the project env
uv run pytest tests/test_x.py -x -q
uv run uvicorn src.server.main:app --reload --port 8000   # dev server (NOT port 8000 if SOREN runs!)
uv run python -c '...'           # one-liners against project deps
```

## One-off tools without touching the project env

```bash
uv run --with pytest --with pytest-asyncio pytest tests -q   # ephemeral deps
uvx ruff check .                                             # run a tool by name
```

## Dependency changes

```bash
uv add httpx                     # updates pyproject + lock
uv add --optional dev pytest-cov # into an extra
uv remove <pkg>
uv lock                          # re-resolve after manual pyproject edits
```

Always commit `pyproject.toml` and `uv.lock` together. Never edit uv.lock
by hand.

## Gotchas in this repo

- Dev extras are NOT installed by plain `uv sync` — tests need
  `uv sync --extra dev` or the `--with pytest` pattern.
- Python version is pinned by `requires-python`; uv manages interpreters —
  don't reach for pyenv shims.
- Port 8000 is the live SOREN server. Dev servers use another port.

## Anti-patterns

- `pip install` anywhere, ever.
- `source .venv/bin/activate` in scripts — `uv run` carries the env.
- Adding deps by editing pyproject without `uv lock` (lock drift breaks
  reproducible rollbacks).
