import {AbstractTilePositionedEvent} from "@/common/AbstractTilePositionedEvent.js";
import {chunkPosition} from "@/common/util.js";
import {CHUNK_SIZE} from "@/common/constants.js";

/**
 * The (x, y) tile at the origin of a chunk. Carried by the chunk lifecycle events
 * so the chunk key can be recovered from (x, y) via AbstractTilePositionedEvent's `chunk` getter,
 * rather than sending the key string over the wire.
 * @param {string} chunk
 * @returns {{x: number, y: number}}
 */
function chunkOriginTile(chunk) {
    const {x, y} = chunkPosition(chunk);
    return {x: x * CHUNK_SIZE, y: y * CHUNK_SIZE};
}

/**
 * Tells a session a chunk has entered its viewport. Sent directly to the session
 * (not via the journal); mods seed the chunk's objects in response.
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
 * Tells a session a chunk has left its viewport, so it can tear down that chunk's
 * sprites and state.
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
 * Seeds a freshly-subscribed chunk: a generic container bundling the individual
 * events that recreate the chunk's objects on the client (one per object, e.g. a
 * BeltInsertEvent per belt). Mods contribute these via `AbstractMod.collectChunkSync`; the
 * client unwraps the bundle and replays each inner event through its normal
 * dispatch, so seeding reuses the same handlers as live updates.
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
