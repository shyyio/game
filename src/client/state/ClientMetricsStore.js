import {AbstractMetricsStore, METRICS_RETENTION_TICKS} from "@/common/AbstractMetricsStore.js";
import {MetricsRollupRow} from "@/common/MetricsFact.js";

/**
 * Browser {@link AbstractMetricsStore}: facts in a plain array, bounded by METRICS_RETENTION_TICKS.
 */
export class ClientMetricsStore extends AbstractMetricsStore {

    constructor() {
        super();
        this._facts = [];
    }

    /**
     * @param {MetricsFact[]} facts
     * @returns {Promise<void>}
     */
    async recordBatch(facts) {
        for (const fact of facts) {
            this._facts.push(fact);
        }
    }

    /**
     * @param {number} type
     * @param {number|null} playerId
     * @param {number} fromTick
     * @param {number} toTick
     * @param {number} bucketTicks
     * @returns {Promise<MetricsRollupRow[]>}
     */
    async queryRollup(type, playerId, fromTick, toTick, bucketTicks) {
        const buckets = new Map();
        for (let i = this._firstIndexAtOrAfter(fromTick); i < this._facts.length; i += 1) {
            const fact = this._facts[i];
            if (fact.tick > toTick) {
                break;
            }
            if (fact.type !== type) {
                continue;
            }
            if (playerId !== null && fact.playerId !== playerId) {
                continue;
            }
            const bucketTick = Math.floor(fact.tick / bucketTicks) * bucketTicks;
            const key = `${bucketTick}:${fact.category}:${fact.tag}`;
            let entry = buckets.get(key);
            if (entry === undefined) {
                entry = new MetricsRollupRow(bucketTick, fact.category, fact.tag, 0, 0);
                buckets.set(key, entry);
            }
            entry.count += 1;
            entry.sum += fact.amount;
        }
        return [...buckets.values()].sort((x, y) => x.bucketTick - y.bucketTick);
    }

    /**
     * @param {number} latestTick
     * @returns {Promise<void>}
     */
    async pruneTo(latestTick) {
        const cutoff = latestTick - METRICS_RETENTION_TICKS;
        if (cutoff <= 0) {
            return;
        }
        // Facts are in non-decreasing tick order, so binary search finds the surviving suffix.
        this._facts.splice(0, this._firstIndexAtOrAfter(cutoff));
    }

    /**
     * @param {number} tick
     * @returns {number} index of the first fact with tick >= tick (or this._facts.length if none)
     * @private
     */
    _firstIndexAtOrAfter(tick) {
        let lo = 0;
        let hi = this._facts.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this._facts[mid].tick < tick) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }
}
