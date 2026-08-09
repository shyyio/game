import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * Answers an {@link MetricsRollupRequestMessage} or a (re)subscribe's initial answer; can span many buckets.
 */
// Dictionary-encoded: buckets and (category, tag) series listed once, rows carry indices
// (see compactRollupRows/expandRollupRows below).
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
 * Dictionary-encodes flat rollup rows into {@link MetricsRollupEvent}'s wire shape; assumes rows already grouped by bucket.
 * @param {MetricsRollupRow[]} rows
 * @returns {{buckets: number[], bucketRowCounts: number[], seriesCategory: number[], seriesTag: number[], seriesIndex: number[], count: number[], sum: number[]}}
 */
export function compactRollupRows(rows) {
    const buckets = [];
    const bucketRowCounts = [];
    const seriesIndexByKey = new Map();
    const seriesCategory = [];
    const seriesTag = [];
    const seriesIndex = [];
    const count = [];
    const sum = [];
    for (const row of rows) {
        if (buckets.length === 0 || buckets[buckets.length - 1] !== row.bucketTick) {
            buckets.push(row.bucketTick);
            bucketRowCounts.push(0);
        }
        bucketRowCounts[bucketRowCounts.length - 1] += 1;

        const key = `${row.category}:${row.tag}`;
        let index = seriesIndexByKey.get(key);
        if (index === undefined) {
            index = seriesCategory.length;
            seriesIndexByKey.set(key, index);
            seriesCategory.push(row.category);
            seriesTag.push(row.tag);
        }
        seriesIndex.push(index);
        count.push(row.count);
        sum.push(row.sum);
    }
    return {buckets, bucketRowCounts, seriesCategory, seriesTag, seriesIndex, count, sum};
}

/**
 * Expands {@link MetricsRollupEvent}'s dictionary-encoded rows back into one flat entry per row.
 * @param {MetricsRollupEvent} event
 * @returns {{bucketTick: number[], category: number[], tag: number[]}}
 */
export function expandRollupRows(event) {
    const bucketTick = [];
    const category = [];
    const tag = [];
    let row = 0;
    for (let b = 0; b < event.buckets.length; b += 1) {
        const bucket = event.buckets[b];
        for (let i = 0; i < event.bucketRowCounts[b]; i += 1) {
            const seriesIndex = event.seriesIndex[row];
            bucketTick.push(bucket);
            category.push(event.seriesCategory[seriesIndex]);
            tag.push(event.seriesTag[seriesIndex]);
            row += 1;
        }
    }
    return {bucketTick, category, tag};
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
