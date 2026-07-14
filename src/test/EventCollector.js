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
     * Returns and clears the events collected since the last drain.
     * @returns {AbstractTilePositionedEvent[]}
     */
    drain() {
        const events = this._events;
        this._events = [];
        return events;
    }
}
