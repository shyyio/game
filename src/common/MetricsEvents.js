import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * Answers an {@link MetricsRollupRequestMessage} or a (re)subscribe's initial answer; can span many buckets.
 */
// Dictionary-encoded: buckets and (category, tag) series listed once, rows carry indices (see GameMetrics' compactRows).
export class MetricsRollupEvent extends AbstractEvent {

    static wireFields = {
        metricsType: "int32",
        scope: "int32",
        bucketTicks: "int32",
        toTick: "int32",
        buckets: "int32[]",
        bucketRowCounts: "int32[]",
        seriesCategory: "int32[]",
        seriesTag: "int32[]",
        seriesIndex: "int32[]",
        count: "int32[]",
        sum: "int32[]",
    };

    /**
     * @param {number} metricsType METRICS_FACT_TYPE_*
     * @param {number} scope METRICS_QUERY_SCOPE_*
     * @param {number} bucketTicks
     * @param {number} toTick the query's right edge (current tick at query time); anchor "now" to this, not the data
     * @param {number[]} buckets distinct bucket-start ticks, ascending, each listed once
     * @param {number[]} bucketRowCounts parallel to buckets — rows belonging to each bucket
     * @param {number[]} seriesCategory distinct (category, tag) pairs, each listed once
     * @param {number[]} seriesTag parallel to seriesCategory
     * @param {number[]} seriesIndex per row (grouped by bucket), index into seriesCategory/seriesTag
     * @param {number[]} count per row
     * @param {number[]} sum per row
     */
    constructor(metricsType, scope, bucketTicks, toTick, buckets, bucketRowCounts, seriesCategory, seriesTag, seriesIndex, count, sum) {
        super();
        this.metricsType = metricsType;
        this.scope = scope;
        this.bucketTicks = bucketTicks;
        this.toTick = toTick;
        this.buckets = buckets;
        this.bucketRowCounts = bucketRowCounts;
        this.seriesCategory = seriesCategory;
        this.seriesTag = seriesTag;
        this.seriesIndex = seriesIndex;
        this.count = count;
        this.sum = sum;
    }
}

/**
 * A live subscription's heartbeat push (GameMetrics.push()): one completed bucket.
 */
export class MetricsRollupBucketEvent extends AbstractEvent {

    static wireFields = {
        metricsType: "int32",
        scope: "int32",
        bucketTicks: "int32",
        toTick: "int32",
        bucketTick: "int32",
        category: "int32[]",
        tag: "int32[]",
        count: "int32[]",
        sum: "int32[]",
        windowTicks: "int32",
    };

    /**
     * @param {number} metricsType METRICS_FACT_TYPE_*
     * @param {number} scope METRICS_QUERY_SCOPE_*
     * @param {number} bucketTicks
     * @param {number} toTick same meaning as MetricsRollupEvent's toTick — not bucketTick below
     * @param {number} bucketTick the one completed bucket every row belongs to
     * @param {number[]} category
     * @param {number[]} tag
     * @param {number[]} count
     * @param {number[]} sum
     * @param {number} windowTicks retention window, so the client cache knows how far back to prune
     */
    constructor(metricsType, scope, bucketTicks, toTick, bucketTick, category, tag, count, sum, windowTicks) {
        super();
        this.metricsType = metricsType;
        this.scope = scope;
        this.bucketTicks = bucketTicks;
        this.toTick = toTick;
        this.bucketTick = bucketTick;
        this.category = category;
        this.tag = tag;
        this.count = count;
        this.sum = sum;
        this.windowTicks = windowTicks;
    }
}
