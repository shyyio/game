import {MetricsEvent} from "@/common/MetricsEvent.js";

/**
 * Buffers metrics facts and tick timestamps in memory, flushed to a store in batches.
 */
export class MetricsRecorder {

    /**
     * @param {AbstractMetricsStore} [store] - omitted when metrics is off; flush() then drops the buffered facts instead of persisting them
     * @param {GameEngine} engine - source of the tick clock
     */
    constructor(store, engine) {
        this.store = store;
        this.engine = engine;
        this._buffer = [];
        this._tickBuffer = [];
    }

    /**
     * @param {number} type METRICS_EVENT_TYPE_*
     * @param {number} playerId PLAYER_ID_NONE when not player-scoped
     * @param {number} [category]
     * @param {number} [amount]
     * @param {number} [tag]
     * @returns {void}
     */
    record(type, playerId, category, amount, tag) {
        this._buffer.push(new MetricsEvent(type, this.engine.clock, playerId, category, amount, tag));
    }

    /**
     * Records this tick's wall-clock time, independent of any metrics fact.
     * @returns {void}
     */
    recordTick() {
        this._tickBuffer.push({tick: this.engine.clock, timestamp: Date.now()});
    }

    /**
     * @param {number} type METRICS_EVENT_TYPE_*
     * @param {number|null} playerId null for unscoped (every player)
     * @param {number} fromTick
     * @param {number} toTick
     * @param {number} bucketTicks
     * @returns {Promise<MetricsRollupRow[]>}
     */
    queryRollup(type, playerId, fromTick, toTick, bucketTicks) {
        if (this.store === undefined) {
            return Promise.resolve([]);
        }
        return this.store.queryRollup(type, playerId, fromTick, toTick, bucketTicks);
    }

    /**
     * Hands buffered events and tick timestamps to the store and clears both buffers.
     * @returns {Promise<void>}
     */
    async flush() {
        const events = this._buffer;
        this._buffer = [];
        const ticks = this._tickBuffer;
        this._tickBuffer = [];
        if (this.store === undefined) {
            return;
        }
        await this.store.recordBatch(events);
        await this.store.recordTicks(ticks);
    }

    /**
     * Closes the underlying store; a no-op when no store was given.
     * @returns {Promise<void>}
     */
    async close() {
        if (this.store === undefined) {
            return;
        }
        await this.store.close();
    }
}
