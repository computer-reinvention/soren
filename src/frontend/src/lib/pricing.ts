// Claude Opus 4.6 (via opencode) pricing per 1M tokens
export const PRICING = {
  input: 5,
  output: 25,
  cache_read: 0.50,
  cache_creation: 6.25,
};

/**
 * Calculate cost in USD from token counts and the standard pricing table.
 * Accepts `cache_write` as an alias for `cache_creation` for convenience.
 */
export function calculateCost(tokens: {
  input: number;
  output: number;
  cache_read: number;
  cache_write?: number;
  cache_creation?: number;
}): number {
  const cacheCreation = tokens.cache_creation ?? tokens.cache_write ?? 0;
  return (
    (tokens.input / 1_000_000) * PRICING.input +
    (tokens.output / 1_000_000) * PRICING.output +
    (tokens.cache_read / 1_000_000) * PRICING.cache_read +
    (cacheCreation / 1_000_000) * PRICING.cache_creation
  );
}
