import {TickEndEvent} from "@/common/CoreEvents.js";
import {AbstractCacheWriter, AbstractCacheView, schemaScalar} from "@/client/state/ClientCache.js";

// The sim's clock, as the server last reported it. The server sends one of these per tick, so the
// client never measures tick length or counts ticks of its own.

export const CLOCK_SCHEMA = {
    tick: schemaScalar(0),
};

/**
 * Writes the clock mirror from the per-tick heartbeat.
 */
export class ClockWriter extends AbstractCacheWriter {

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof TickEndEvent) {
            this._state.set("clock.tick", event.clock);
        }
    }
}

/**
 * Derived reads over the clock namespace.
 */
export class ClockView extends AbstractCacheView {

    /**
     * The tick the sim last finished, 0 until the first heartbeat arrives.
     * @returns {number}
     */
    tick() {
        return this._state.get("clock.tick");
    }
}
