import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * Tells a session a chunk has entered its viewport, so mods sync its objects.
 */
export class ChunkSubscribeEvent extends AbstractEvent {

    static wireFields = {
        chunkKey: "int32",
    };

    /**
     * @param {number} chunkKey
     */
    constructor(chunkKey) {
        super();
        this.chunkKey = chunkKey;
    }
}

/**
 * Tells a session a chunk has left its viewport, so it can tear down that chunk's state.
 */
export class ChunkUnsubscribeEvent extends AbstractEvent {

    static wireFields = {
        chunkKey: "int32",
    };

    /**
     * @param {number} chunkKey
     */
    constructor(chunkKey) {
        super();
        this.chunkKey = chunkKey;
    }
}

/**
 * The sim finished a tick, carrying the world clock it finished at. Sent to every session every
 * tick, so a client reads the tick it is in.
 */
export class TickEndEvent extends AbstractEvent {

    static wireFields = {
        clock: "int32",
    };

    /**
     * @param {number} clock whole ticks the world has run
     */
    constructor(clock) {
        super();
        this.clock = clock;
    }
}

/**
 * Syncs a subscribed chunk by bundling the per-object recreate events (from the engine's `chunkSync`).
 */
export class ChunkSyncEvent extends AbstractEvent {

    static wireFields = {
        chunkKey: "int32",
        events: "message[]",
    };

    /**
     * @param {number} chunkKey
     * @param {AbstractEvent[]} events
     */
    constructor(chunkKey, events) {
        super();
        this.chunkKey = chunkKey;
        this.events = events;
    }
}
