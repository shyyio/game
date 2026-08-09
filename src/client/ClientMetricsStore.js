import {AbstractMetricsStore, METRICS_RETENTION_TICKS} from "@/common/AbstractMetricsStore.js";
import {MetricsRollupRow} from "@/common/MetricsEvent.js";

/**
 * Browser {@link AbstractMetricsStore}: events in a plain array, bounded by METRICS_RETENTION_TICKS.
 */
export class ClientMetricsStore extends AbstractMetricsStore {

    constructor() {
        super();
        this._events = [];
        this._ticks = new Map();
        this._latestTick = 0;
    }

    /**
     * @param {MetricsEvent[]} events
     * @returns {Promise<void>}
     */
    async recordBatch(events) {
        this._events.push(...events);
    }

    /**
     * @param {number} type
     * @param {number|null} playerId
     * @param {number} fromTick
     * @param {number} toTick
     * @returns {Promise<MetricsEvent[]>}
     */
    async queryRange(type, playerId, fromTick, toTick) {
        const result = [];
        for (let i = this._firstIndexAtOrAfter(fromTick); i < this._events.length; i += 1) {
            const event = this._events[i];
            if (event.tick > toTick) {
                break;
            }
            if (event.type === type && (playerId === null || event.playerId === playerId)) {
                result.push(event);
            }
        }
        return result;
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
        for (let i = this._firstIndexAtOrAfter(fromTick); i < this._events.length; i += 1) {
            const event = this._events[i];
            if (event.tick > toTick) {
                break;
            }
            if (event.type !== type) {
                continue;
            }
            if (playerId !== null && event.playerId !== playerId) {
                continue;
            }
            const bucketTick = Math.floor(event.tick / bucketTicks) * bucketTicks;
            const key = `${bucketTick}:${event.category}:${event.tag}`;
            let entry = buckets.get(key);
            if (entry === undefined) {
                entry = new MetricsRollupRow(bucketTick, event.category, event.tag, 0, 0);
                buckets.set(key, entry);
            }
            entry.count += 1;
            entry.sum += event.amount;
        }
        return [...buckets.values()].sort((x, y) => x.bucketTick - y.bucketTick);
    }

    /**
     * @param {{tick: number, timestamp: number}[]} ticks
     * @returns {Promise<void>}
     */
    async recordTicks(ticks) {
        for (const entry of ticks) {
            if (!this._ticks.has(entry.tick)) {
                this._ticks.set(entry.tick, entry.timestamp);
            }
            if (entry.tick > this._latestTick) {
                this._latestTick = entry.tick;
            }
        }
        this._prune();
    }

    /**
     * Drops events/ticks older than METRICS_RETENTION_TICKS behind the latest known tick.
     * @private
     * @returns {void}
     */
    _prune() {
        const cutoff = this._latestTick - METRICS_RETENTION_TICKS;
        if (cutoff <= 0) {
            return;
        }
        // Events are in non-decreasing tick order, so binary search finds the surviving suffix.
        this._events.splice(0, this._firstIndexAtOrAfter(cutoff));
        // _ticks insertion order is ascending tick order too.
        for (const tick of this._ticks.keys()) {
            if (tick >= cutoff) {
                break;
            }
            this._ticks.delete(tick);
        }
    }

    /**
     * @param {number} tick
     * @returns {number} index of the first event with tick >= tick (or this._events.length if none)
     * @private
     */
    _firstIndexAtOrAfter(tick) {
        let lo = 0;
        let hi = this._events.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this._events[mid].tick < tick) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    /**
     * @param {number} fromTick
     * @param {number} toTick
     * @returns {Promise<{tick: number, timestamp: number}[]>}
     */
    async queryTickTimestamps(fromTick, toTick) {
        const rows = [];
        for (const [tick, timestamp] of this._ticks) {
            if (tick >= fromTick && tick <= toTick) {
                rows.push({tick, timestamp});
            }
        }
        rows.sort((a, b) => a.tick - b.tick);
        return rows;
    }
}
