"""Cache-Control headers for the SPA static file mount (P6.3 performance audit).

Vite content-hashes everything under dist/assets/, so those files are safe
to cache for a year as immutable. index.html (and anything else with a
fixed filename, or served as the SPA fallback) must always be revalidated
so it never keeps pointing at a stale/deleted assets/ filename after a
new deploy.
"""
import os
from pathlib import Path

import pytest

FRONTEND_DIST = Path("src/frontend/dist")

pytestmark = pytest.mark.skipif(
    not FRONTEND_DIST.exists(), reason="frontend not built (no src/frontend/dist)"
)


def _first_real_asset() -> str:
    """An actual hashed filename currently in dist/assets/, whatever it is."""
    assets_dir = FRONTEND_DIST / "assets"
    for entry in assets_dir.iterdir():
        if entry.is_file():
            return entry.name
    pytest.skip("dist/assets/ is empty")


def test_real_asset_file_gets_immutable_long_lived_cache_control(client):
    filename = _first_real_asset()
    response = client.get(f"/assets/{filename}")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_index_html_is_never_cached(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-cache"


def test_spa_deep_link_fallback_to_index_html_is_never_cached(client):
    response = client.get("/agents/some-agent-that-is-a-client-route")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-cache"


def test_missing_assets_path_falls_back_to_index_html_without_immutable_cache(client):
    """Regression guard: a stale reference to a deleted build's hashed
    filename must NOT be served with a year-long immutable cache-control
    just because the request path happened to start with "assets/" — that
    was a real bug caught before this endpoint shipped (the fallback
    branch was inheriting the immutable header meant for real asset hits).
    """
    response = client.get("/assets/this-file-does-not-exist-abc123.js")
    assert response.status_code == 200  # SPA fallback serves index.html content
    assert response.headers["cache-control"] == "no-cache"
