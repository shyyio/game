import {metricsRollupKey} from "@/common/MetricsFact.js";
import {MetricsRollupEvent, MetricsRollupBucketEvent, expandRollupRows} from "@/common/MetricsEvents.js";
import {AbstractCacheWriter, AbstractCacheView, schemaMap} from "@/client/state/ClientCache.js";

export const METRICS_SCHEMA = {
    rollups: schemaMap(),
};

/**
 * The cached rollup for one (metricsType, scope): parallel per-row arrays plus the query params they answer.
 */
export class MetricsRollup {

    /**
     * @param {number} metricsType METRICS_FACT_TYPE_*
     * @param {number} scope METRICS_QUERY_SCOPE_*
     * @param {number} bucketTicks
     * @param {number} toTick
     * @param {number[]} bucketTick
     * @param {number[]} category
     * @param {number[]} tag
     * @param {number[]} count
     * @param {number[]} sum
     */
    constructor(metricsType, scope, bucketTicks, toTick, bucketTick, category, tag, count, sum) {
        this.metricsType = metricsType;
        this.scope = scope;
        this.bucketTicks = bucketTicks;
        this.toTick = toTick;
        this.bucketTick = bucketTick;
        this.category = category;
        this.tag = tag;
        this.count = count;
        this.sum = sum;
    }

    /**
     * @param {MetricsRollupEvent} event
     * @returns {MetricsRollup}
     */
    static fromRollupEvent(event) {
        const {bucketTick, category, tag} = expandRollupRows(event);
        return new MetricsRollup(
            event.metricsType, event.scope, event.bucketTicks, event.toTick,
            bucketTick, category, tag, event.count, event.sum,
        );
    }

    /**
     * Merges one completed bucket into the previous rollup, deduping on (bucketTick, category, tag) and pruning past windowTicks.
     * @param {MetricsRollup|undefined} previous
     * @param {MetricsRollupBucketEvent} event
     * @returns {MetricsRollup}
     */
    static mergeBucket(previous, event) {
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
        return new MetricsRollup(
            event.metricsType, event.scope, event.bucketTicks, event.toTick,
            bucketTick, category, tag, count, sum,
        );
    }
}

/**
 * Writes the latest {@link MetricsRollup} per (metricsType, scope).
 */
export class MetricsWriter extends AbstractCacheWriter {

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        const key = metricsRollupKey(event.metricsType, event.scope);
        if (event instanceof MetricsRollupEvent) {
            this._state.mapSet("metrics.rollups", key, MetricsRollup.fromRollupEvent(event));
        } else if (event instanceof MetricsRollupBucketEvent) {
            this._state.mapSet(
                "metrics.rollups", key,
                MetricsRollup.mergeBucket(this._state.mapGet("metrics.rollups", key), event),
            );
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
     * @returns {MetricsRollup|undefined} undefined until a response/push arrives
     */
    rollup(metricsType, scope) {
        return this._state.mapGet("metrics.rollups", metricsRollupKey(metricsType, scope));
    }
}
