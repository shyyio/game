import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * Tells a session a chunk has entered its viewport, so mods sync its objects.
 */
export class ChunkSubscribeEvent extends AbstractEvent {

    static wireFields = {
        chunk: "int32",
    };

    /**
     * @param {number} chunk
     */
    constructor(chunk) {
        super();
        this.chunk = chunk;
    }
}

/**
 * Tells a session a chunk has left its viewport, so it can tear down that chunk's state.
 */
export class ChunkUnsubscribeEvent extends AbstractEvent {

    static wireFields = {
        chunk: "int32",
    };

    /**
     * @param {number} chunk
     */
    constructor(chunk) {
        super();
        this.chunk = chunk;
    }
}

/**
 * Syncs a subscribed chunk by bundling the per-object recreate events (from the engine's `chunkSync`).
 */
export class ChunkSyncEvent extends AbstractEvent {

    static wireFields = {
        chunk: "int32",
        events: "message[]",
    };

    /**
     * @param {number} chunk
     * @param {AbstractEvent[]} events
     */
    constructor(chunk, events) {
        super();
        this.chunk = chunk;
        this.events = events;
    }
}
