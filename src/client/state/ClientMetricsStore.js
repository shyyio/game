import {AbstractMetricsStore, METRICS_RETENTION_TICKS} from "@/common/AbstractMetricsStore.js";
import {MetricsRollupRow} from "@/common/MetricsEntry.js";
import {bucketTickFor} from "@/common/MetricsTiers.js";

/**
 * Browser {@link AbstractMetricsStore}: entries in a plain array, bounded by METRICS_RETENTION_TICKS.
 */
export class ClientMetricsStore extends AbstractMetricsStore {

    constructor() {
        super();
        this._entries = [];
    }

    /**
     * @param {MetricsEntry[]} entries
     * @returns {Promise<void>}
     */
    async insertEntries(entries) {
        for (const entry of entries) {
            this._entries.push(entry);
        }
    }

    /**
     * @param {number} type
     * @param {number|null} playerRef
     * @param {number} fromTick
     * @param {number} toTick
     * @param {number} tier
     * @returns {Promise<MetricsRollupRow[]>}
     */
    async queryRollup(type, playerRef, fromTick, toTick, tier) {
        const buckets = new Map();
        for (let i = this._firstIndexAtOrAfter(fromTick); i < this._entries.length; i += 1) {
            const entry = this._entries[i];
            if (entry.tick > toTick) {
                break;
            }
            if (entry.type !== type) {
                continue;
            }
            if (playerRef !== null && entry.playerRef !== playerRef) {
                continue;
            }
            const bucketTick = bucketTickFor(entry.tick, tier);
            const key = `${bucketTick}:${entry.category}:${entry.tag}`;
            let row = buckets.get(key);
            if (row === undefined) {
                row = new MetricsRollupRow(bucketTick, entry.category, entry.tag, 0, 0);
                buckets.set(key, row);
            }
            row.count += 1;
            row.sum += entry.amount;
        }
        return Array.from(buckets.values()).sort((x, y) => x.bucketTick - y.bucketTick);
    }

    /**
     * Drops entries past the retention window; nothing here is pre-aggregated.
     * @param {number} latestTick
     * @returns {Promise<void>}
     */
    async advanceTo(latestTick) {
        const cutoff = latestTick - METRICS_RETENTION_TICKS;
        if (cutoff <= 0) {
            return;
        }
        // Facts are in non-decreasing tick order, so binary search finds the surviving suffix.
        this._entries.splice(0, this._firstIndexAtOrAfter(cutoff));
    }

    /**
     * @param {number} tick
     * @returns {number} index of the first entry with tick >= tick (or this._entries.length if none)
     * @private
     */
    _firstIndexAtOrAfter(tick) {
        let lo = 0;
        let hi = this._entries.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this._entries[mid].tick < tick) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }
}
