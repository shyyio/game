import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";

/**
 * Unpacks any batches in `events` into their per-delta events, the way a client replays them, so a
 * spec asserts on the events handlers see rather than on the wire packing.
 * @param {AbstractEvent[]} events
 * @returns {AbstractEvent[]}
 */
export function flattenBatches(events) {
    const flat = [];
    for (const event of events) {
        if (event instanceof AbstractBatchEvent) {
            flat.push(...event.explode());
            continue;
        }
        flat.push(event);
    }
    return flat;
}

/**
 * Test sink that buffers a GameEngine's emitted domain events for pull-style assertions.
 */
export class EventCollector {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        /**
         * @type {AbstractEvent[]}
         */
        this._events = [];
        engine.setEventSink(event => this._events.push(event));
    }

    /**
     * Returns and clears the events collected since the last drain, batches unpacked into their
     * per-delta events the way a client replays them.
     * @returns {AbstractEvent[]}
     */
    drain() {
        const events = flattenBatches(this._events);
        this._events = [];
        return events;
    }
}
