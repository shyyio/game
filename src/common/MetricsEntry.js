// Category-first: METRICS_ENTRY_TYPE_<what happened>; category/amount/tag meaning per-type, at each emitMetricsEntry call site.
// Flat shared integer keyspace across engine and mods (mod-added ids live in the owning mod, e.g. Market's 3).
export const METRICS_ENTRY_TYPE_OBJECT_PLACED = 0;
export const METRICS_ENTRY_TYPE_OBJECT_DESPAWNED = 1;
export const METRICS_ENTRY_TYPE_ITEM_PRODUCED = 2;
export const METRICS_ENTRY_TYPE_PLAYER_JOINED = 4;
export const METRICS_ENTRY_TYPE_PLAYER_LEFT = 5;
/** @typedef {number} MetricsEntryType */

// MetricsRollupRequestMessage's `scope`: OWN is the requesting player; GLOBAL only for types a mod
// declared globally queryable (AbstractModDeclaration.metricsGlobalQueries).
export const METRICS_QUERY_SCOPE_OWN = 0;
export const METRICS_QUERY_SCOPE_GLOBAL = 1;
/** @typedef {number} MetricsQueryScope */
const METRICS_QUERY_SCOPE_COUNT = 2;

/**
 * Packs (metricsType, scope) into one dense integer key; shared by the client cache and the sim's subscription registry.
 * @param {number} metricsType
 * @param {number} scope
 * @returns {number}
 */
export function metricsRollupKey(metricsType, scope) {
    return metricsType * METRICS_QUERY_SCOPE_COUNT + scope;
}

/**
 * One queryRollup() bucket: a (bucketTick, category, tag) group with its aggregated count/sum.
 */
export class MetricsRollupRow {

    /**
     * @param {number} bucketTick
     * @param {number} category
     * @param {number} tag
     * @param {number} count
     * @param {number} sum
     */
    constructor(bucketTick, category, tag, count, sum) {
        this.bucketTick = bucketTick;
        this.category = category;
        this.tag = tag;
        this.count = count;
        this.sum = sum;
    }
}

/**
 * One recorded metrics entry, numeric only.
 */
export class MetricsEntry {

    /**
     * @param {MetricsEntryType} type
     * @param {number} tick sim clock at record time
     * @param {number} playerRef PLAYER_REF_NONE when not player-scoped
     * @param {number} category grouped as-is by queryRollup; meaning depends on type (itemTypeId, objectTypeId, ...)
     * @param {number} amount summed by queryRollup; meaning depends on type
     * @param {number} tag grouped as-is by queryRollup; meaning depends on type (e.g. trade side)
     */
    constructor(type, tick, playerRef, category=0, amount=0, tag=0) {
        this.type = type;
        this.tick = tick;
        this.playerRef = playerRef;
        this.category = category;
        this.amount = amount;
        this.tag = tag;
    }
}
