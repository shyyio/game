import {NotImplementedError} from "@/common/error.js";

// Shared by both backends so server and local-play sessions prune to the same history depth.
export const METRICS_RETENTION_TICKS = 50_000;

/**
 * Persists metrics events and answers time-range queries. Backends store this however suits their
 * platform (SQLite on Node, in-memory on the browser for local play).
 * @abstract
 */
export class AbstractMetricsStore {

    /**
     * Persists a batch of events, in order.
     * @abstract
     * @param {MetricsEvent[]} events
     * @returns {Promise<void>}
     */
    async recordBatch(events) {
        throw new NotImplementedError();
    }

    // Queried by tick, not wall-clock timestamp, to stay immune to tick-length jitter.
    /**
     * Raw events of one type in a tick range, optionally scoped to one player.
     * @abstract
     * @param {number} type METRICS_EVENT_TYPE_*
     * @param {number|null} playerId null for unscoped (every player)
     * @param {number} fromTick
     * @param {number} toTick
     * @returns {Promise<MetricsEvent[]>}
     */
    async queryRange(type, playerId, fromTick, toTick) {
        throw new NotImplementedError();
    }

    // Bucket tick is its start tick: floor(tick / bucketTicks) * bucketTicks.
    /**
     * Bucketed (bucket, category, tag) aggregates of one type in a tick range, optionally scoped to one player.
     * @abstract
     * @param {number} type METRICS_EVENT_TYPE_*
     * @param {number|null} playerId null for unscoped (every player)
     * @param {number} fromTick
     * @param {number} toTick
     * @param {number} bucketTicks - bucket width, in ticks
     * @returns {Promise<MetricsRollupRow[]>}
     */
    async queryRollup(type, playerId, fromTick, toTick, bucketTicks) {
        throw new NotImplementedError();
    }

    /**
     * Persists a batch of tick -> wall-clock mappings, idempotent on tick.
     * @abstract
     * @param {{tick: number, timestamp: number}[]} ticks
     * @returns {Promise<void>}
     */
    async recordTicks(ticks) {
        throw new NotImplementedError();
    }

    /**
     * The tick -> timestamp table over a tick range.
     * @abstract
     * @param {number} fromTick
     * @param {number} toTick
     * @returns {Promise<{tick: number, timestamp: number}[]>}
     */
    async queryTickTimestamps(fromTick, toTick) {
        throw new NotImplementedError();
    }
}
