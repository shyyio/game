// A tier is a rollup's bucket width in ticks: which zoom level a chart asks for, and which
// aggregate a store keeps pre-baked.

// The only widths a rollup may be asked for, coarsening as the chart zooms out.
export const TIER_LADDER = [10, 100, 1000, 6000];

// Tiers a store pre-aggregates. The finest tier stays a raw-fact query: its zoom level spans a few
// hundred ticks at most, while each wider tier would otherwise scan millions of facts.
export const METRICS_BAKED_TIERS = TIER_LADDER.slice(1);

// Facts fold into buckets one window of this width at a time, so a query's un-baked tail is never
// more than this many ticks of raw facts. Every wider tier is a whole number of these.
export const METRICS_FOLD_TIER = TIER_LADDER[1];

// Tiers folded from the fold tier's buckets rather than from facts.
export const METRICS_COARSE_TIERS = TIER_LADDER.slice(2);

// Bucket ceiling per request, well above the ~170 the chart's own zoom ever asks for. Bounds what
// one message can make a store read, since the finest tier is served by scanning facts.
export const MAX_BUCKETS_PER_REQUEST = 2000;

/**
 * The start tick of the bucket `tick` falls in.
 * @param {number} tick
 * @param {number} tier
 * @returns {number}
 */
export function bucketTickFor(tick, tier) {
    return Math.floor(tick / tier) * tier;
}
