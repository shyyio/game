import {NotImplementedError} from "@/common/error.js";
import {DEFAULT_TICK_MS} from "@/common/constants.js";

// Shared by both backends so server and local-play sessions prune to the same history depth.
const RETENTION_DAYS = 30;
export const METRICS_RETENTION_TICKS = RETENTION_DAYS * 24 * 60 * 60 * 1000 / DEFAULT_TICK_MS;

/**
 * Persists metrics facts and answers rollup queries. Backends store this however suits their
 * platform (SQLite on Node, in-memory on the browser for local play).
 * @abstract
 */
export class AbstractMetricsStore {

    /**
     * Persists a batch of facts, in order.
     * @abstract
     * @param {MetricsFact[]} facts
     * @returns {Promise<void>}
     */
    async recordBatch(facts) {
        throw new NotImplementedError();
    }

    // Queried by tick, not wall-clock timestamp, to stay immune to tick-length jitter.
    // Bucket tick is its start tick: floor(tick / bucketTicks) * bucketTicks.
    /**
     * Bucketed (bucket, category, tag) aggregates of one type in a tick range, optionally scoped to one player.
     * @abstract
     * @param {number} type METRICS_FACT_TYPE_*
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
     * Drops facts more than METRICS_RETENTION_TICKS behind `latestTick`.
     * @abstract
     * @param {number} latestTick
     * @returns {Promise<void>}
     */
    async pruneTo(latestTick) {
        throw new NotImplementedError();
    }

    /**
     * Releases backend resources; backends without any keep this no-op.
     * @returns {Promise<void>}
     */
    async close() {
    }
}
