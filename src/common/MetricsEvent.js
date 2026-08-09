// Category-first: METRICS_EVENT_TYPE_<what happened>; category/amount/tag meaning per-type, at each emitMetrics call site.
export const METRICS_EVENT_TYPE_OBJECT_PLACED = 0;
export const METRICS_EVENT_TYPE_OBJECT_DESPAWNED = 1;
export const METRICS_EVENT_TYPE_ITEM_PRODUCED = 2;
export const METRICS_EVENT_TYPE_TRADE_EXECUTED = 3;
export const METRICS_EVENT_TYPE_PLAYER_JOINED = 4;
export const METRICS_EVENT_TYPE_PLAYER_LEFT = 5;

// TRADE_EXECUTED's `tag`: trade side `playerId` was on; a global price series should read SELL rows only.
export const METRICS_TRADE_SIDE_SELL = 0;
export const METRICS_TRADE_SIDE_BUY = 1;

// MetricsRollupRequestMessage's `scope`: OWN is the requesting player; GLOBAL only for public types (see MetricsMessages.js's GLOBAL_QUERYABLE_TYPES).
export const METRICS_QUERY_SCOPE_OWN = 0;
export const METRICS_QUERY_SCOPE_GLOBAL = 1;

/**
 * Packs (metricsType, scope) into one dense integer key; shared by the client cache and the sim's subscription registry.
 * @param {number} metricsType
 * @param {number} scope
 * @returns {number}
 */
export function metricsRollupKey(metricsType, scope) {
    return metricsType * 2 + scope;
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

    /**
     * Decodes a NodeMetricsStore SQL row (snake_case bucket_tick column) into a row instance.
     * @param {{bucket_tick: number, category: number, tag: number, count: number, sum: number}} sqlRow
     * @returns {MetricsRollupRow}
     */
    static fromSqlRow(sqlRow) {
        return new MetricsRollupRow(sqlRow.bucket_tick, sqlRow.category, sqlRow.tag, sqlRow.count, sqlRow.sum);
    }
}

/**
 * One recorded metrics fact — numeric only, no strings.
 */
export class MetricsEvent {

    /**
     * @param {number} type METRICS_EVENT_TYPE_*
     * @param {number} tick sim clock at record time; wall-clock looked up separately via the Tick table
     * @param {number} playerId PLAYER_ID_NONE when not player-scoped
     * @param {number} category grouped as-is by queryRollup; meaning depends on type (itemType, typeId, ...)
     * @param {number} amount summed by queryRollup; meaning depends on type
     * @param {number} tag grouped as-is by queryRollup; meaning depends on type (e.g. trade side)
     */
    constructor(type, tick, playerId, category=0, amount=0, tag=0) {
        this.type = type;
        this.tick = tick;
        this.playerId = playerId;
        this.category = category;
        this.amount = amount;
        this.tag = tag;
    }
}
