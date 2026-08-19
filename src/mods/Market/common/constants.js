// No terminal configured yet.
export const MARKET_MODE_NONE = 0;
// Sell to market: consumes configured item from input port.
export const MARKET_MODE_SELL = 1;
// Buy from market: produces configured item onto output port.
export const MARKET_MODE_BUY = 2;

// Per-player currency balance (server-authoritative).
export const MARKET_SETTING_BALANCE = 10;

// Granted once, on a player's first connect: nothing else seeds a balance, and every NPC listing is
// buy-side, so a player with nothing cannot trade their way to a first credit.
export const MARKET_STARTING_BALANCE = 10000;

// This mod's metrics fact type: one fact per trade side (shared flat keyspace, see MetricsFact.js).
export const METRICS_FACT_TYPE_TRADE_EXECUTED = 3;

// TRADE_EXECUTED's `tag`: trade side `playerId` was on; a global price series reads SELL rows only.
export const METRICS_TRADE_SIDE_SELL = 0;
export const METRICS_TRADE_SIDE_BUY = 1;

// Ticks between guide-price recomputes; stands in for "24 in-game hours".
export const GUIDE_PRICE_INTERVAL_TICKS = 86400;

// Per-interval cap on guide-price movement, as fraction of current value.
export const GUIDE_PRICE_MAX_STEP_FRACTION = 0.05;
