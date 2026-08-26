"""Locks in the corrected claude-sonnet-5 fallback pricing.

Regression guard for the ~2.5x overcharge bug: this table was priced as
Claude Opus 4.6 ($5/$25/$0.50/$6.25 per 1M input/output/cache_read/
cache_write) while every agent actually runs claude-sonnet-5, whose real
rates (matching opencode's own models.json pricing cache) are less than
half that. If these assertions ever need to change, it should be because
the fleet's model actually changed — not by accident.
"""
from src.server.services import pricing


def test_pricing_rates_match_claude_sonnet_5_not_opus():
    assert pricing.INPUT_PRICE_PER_TOKEN == 2.00 / 1_000_000
    assert pricing.OUTPUT_PRICE_PER_TOKEN == 10.00 / 1_000_000
    assert pricing.CACHE_READ_PRICE_PER_TOKEN == 0.20 / 1_000_000
    assert pricing.CACHE_WRITE_PRICE_PER_TOKEN == 2.50 / 1_000_000


def test_tokens_to_usd_matches_expected_formula():
    cost = pricing.tokens_to_usd(
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        cache_read_tokens=1_000_000,
        cache_creation_tokens=1_000_000,
    )
    assert cost == 2.00 + 10.00 + 0.20 + 2.50


def test_tokens_to_usd_defaults_cache_args_to_zero():
    assert pricing.tokens_to_usd(1_000_000, 1_000_000) == 2.00 + 10.00


def test_budget_guard_reexports_tokens_to_usd():
    """budget_guard.tokens_to_usd is used elsewhere (quality_metrics.py) —
    guard the backward-compat re-export."""
    from src.server.services import budget_guard

    assert budget_guard.tokens_to_usd is pricing.tokens_to_usd
