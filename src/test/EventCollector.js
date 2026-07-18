import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";

/**
 * Test sink that buffers a GameEngine's emitted domain events for pull-style assertions.
 */
export class EventCollector {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        this._events = [];
        engine.setEventSink(event => this._events.push(event));
    }

    /**
     * Returns and clears the events collected since the last drain, batches unpacked into their
     * per-delta events the way a client replays them.
     * @returns {AbstractTilePositionedEvent[]}
     */
    drain() {
        const events = [];
        for (const event of this._events) {
            if (event instanceof AbstractBatchEvent) {
                events.push(...event.explode());
                continue;
            }
            events.push(event);
        }
        this._events = [];
        return events;
    }
}
