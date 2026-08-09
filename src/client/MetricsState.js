import {metricsRollupKey} from "@/common/MetricsEvent.js";
import {MetricsRollupEvent, MetricsRollupBucketEvent} from "@/common/MetricsQueryEvents.js";
import {AbstractCacheWriter, AbstractCacheView, schemaMap} from "@/client/ClientCache.js";

export const METRICS_SCHEMA = {
    rollups: schemaMap(),
};

/**
 * Expands MetricsRollupEvent's dictionary-encoded rows back into one flat entry per row.
 * @param {MetricsRollupEvent} event
 * @returns {{bucketTick: number[], category: number[], tag: number[]}}
 */
function expandRollupRows(event) {
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
 * Merges one completed bucket into a cached rollup entry, deduping on (bucketTick, category, tag) and pruning past windowTicks.
 * @param {object|undefined} previous the cached {bucketTick, category, tag, count, sum} entry, if any
 * @param {MetricsRollupBucketEvent} event
 * @returns {object}
 */
function mergeBucket(previous, event) {
    const byKey = new Map();
    if (previous !== undefined && previous.bucketTicks === event.bucketTicks) {
        for (let i = 0; i < previous.bucketTick.length; i += 1) {
            byKey.set(`${previous.bucketTick[i]}:${previous.category[i]}:${previous.tag[i]}`, {
                bucketTick: previous.bucketTick[i], category: previous.category[i], tag: previous.tag[i],
                count: previous.count[i], sum: previous.sum[i],
            });
        }
    }
    for (let i = 0; i < event.category.length; i += 1) {
        byKey.set(`${event.bucketTick}:${event.category[i]}:${event.tag[i]}`, {
            bucketTick: event.bucketTick, category: event.category[i], tag: event.tag[i],
            count: event.count[i], sum: event.sum[i],
        });
    }
    const minKeepTick = event.toTick - event.windowTicks;
    const bucketTick = [];
    const category = [];
    const tag = [];
    const count = [];
    const sum = [];
    for (const point of byKey.values()) {
        if (point.bucketTick < minKeepTick) {
            continue;
        }
        bucketTick.push(point.bucketTick);
        category.push(point.category);
        tag.push(point.tag);
        count.push(point.count);
        sum.push(point.sum);
    }
    return {
        metricsType: event.metricsType,
        scope: event.scope,
        bucketTicks: event.bucketTicks,
        toTick: event.toTick,
        bucketTick,
        category,
        tag,
        count,
        sum,
    };
}

/**
 * Writes the latest rollup per (metricsType, scope) as a flat {bucketTick, category, tag, count, sum} shape.
 */
export class MetricsWriter extends AbstractCacheWriter {

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        const key = metricsRollupKey(event.metricsType, event.scope);
        if (event instanceof MetricsRollupEvent) {
            const {bucketTick, category, tag} = expandRollupRows(event);
            this._state.mapSet("metrics.rollups", key, {
                metricsType: event.metricsType,
                scope: event.scope,
                bucketTicks: event.bucketTicks,
                toTick: event.toTick,
                bucketTick,
                category,
                tag,
                count: event.count,
                sum: event.sum,
            });
        } else if (event instanceof MetricsRollupBucketEvent) {
            this._state.mapSet("metrics.rollups", key, mergeBucket(this._state.mapGet("metrics.rollups", key), event));
        }
    }
}

/**
 * Derived reads over the metrics namespace.
 */
export class MetricsView extends AbstractCacheView {

    /**
     * @param {number} metricsType
     * @param {number} scope
     * @returns {object|undefined} the flat {bucketTick, category, tag, count, sum} shape; undefined until a response/push arrives
     */
    rollup(metricsType, scope) {
        return this._state.mapGet("metrics.rollups", metricsRollupKey(metricsType, scope));
    }
}
