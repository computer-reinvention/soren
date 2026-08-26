"""Token-based cost estimate — the *fallback* used only when opencode's own
real, already-priced cost isn't available for a session (see
``opencode_transcripts.py``, which is authoritative and preferred
everywhere it has data; this is just the gap-filler).

Split out from ``budget_guard.py`` into its own module with no dependency
on ``conversation_store.py`` so ``conversation_store.py`` can use it too
without a circular import (``budget_guard`` already depends on
``conversation_store`` for daily/summary queries).

Rates are claude-sonnet-5 via Anthropic (USD per token, matching
opencode's own models.json pricing cache) — every agent has actually run
Sonnet for a while now. This table was previously priced as Opus 4.6
($5/$25/$0.50/$6.25 per 1M), which overstated every cost figure in the
dashboard by roughly 2.5x. Update these if/when the fleet moves to a
different model.
"""

INPUT_PRICE_PER_TOKEN = 2.00 / 1_000_000
OUTPUT_PRICE_PER_TOKEN = 10.00 / 1_000_000
CACHE_READ_PRICE_PER_TOKEN = 0.20 / 1_000_000
CACHE_WRITE_PRICE_PER_TOKEN = 2.50 / 1_000_000


def tokens_to_usd(
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
) -> float:
    """Convert token counts to an estimated USD cost."""
    return (
        input_tokens * INPUT_PRICE_PER_TOKEN
        + output_tokens * OUTPUT_PRICE_PER_TOKEN
        + cache_read_tokens * CACHE_READ_PRICE_PER_TOKEN
        + cache_creation_tokens * CACHE_WRITE_PRICE_PER_TOKEN
    )
