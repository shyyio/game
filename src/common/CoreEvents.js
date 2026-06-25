import {AbstractTilePositionedEvent} from "@/common/AbstractTilePositionedEvent.js";
import {chunkPosition} from "@/common/util.js";
import {CHUNK_SIZE} from "@/common/constants.js";

/**
 * The (x, y) tile at the origin of a chunk, so the key can be recovered from (x, y) instead of wired.
 * @param {string} chunk
 * @returns {{x: number, y: number}}
 */
function chunkOriginTile(chunk) {
    const {x, y} = chunkPosition(chunk);
    return {x: x * CHUNK_SIZE, y: y * CHUNK_SIZE};
}

/**
 * Tells a session a chunk has entered its viewport, so mods seed its objects.
 */
export class ChunkSubscribeEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
    };

    /**
     * @param {string} chunk
     */
    constructor(chunk) {
        const {x, y} = chunkOriginTile(chunk);
        super(x, y);
    }
}

/**
 * Tells a session a chunk has left its viewport, so it can tear down that chunk's state.
 */
export class ChunkUnsubscribeEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
    };

    /**
     * @param {string} chunk
     */
    constructor(chunk) {
        const {x, y} = chunkOriginTile(chunk);
        super(x, y);
    }
}

/**
 * Seeds a subscribed chunk by bundling the per-object events (from `AbstractMod.collectChunkSync`) that recreate it on the client.
 */
export class ChunkSyncEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        events: "message[]",
    };

    /**
     * @param {string} chunk
     * @param {AbstractEvent[]} events
     */
    constructor(chunk, events) {
        const {x, y} = chunkOriginTile(chunk);
        super(x, y);
        this.events = events;
    }
}
