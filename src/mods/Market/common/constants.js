// No terminal configured yet.
export const MARKET_MODE_NONE = 0;
// Sell to market: consumes configured item from input port.
export const MARKET_MODE_SELL = 1;
// Buy from market: produces configured item onto output port.
export const MARKET_MODE_BUY = 2;

// Per-player currency balance (server-authoritative).
export const MARKET_SETTING_BALANCE = 10;

// Ticks between guide-price recomputes; stands in for "24 in-game hours".
export const GUIDE_PRICE_INTERVAL_TICKS = 86400;

// Per-interval cap on guide-price movement, as fraction of current value.
export const GUIDE_PRICE_MAX_STEP_FRACTION = 0.05;
