/**
 * A collaborator the engine calls by name: once per tick in phase order, and at the lifecycle
 * moments below. Every hook is optional and defaults to doing nothing. Systems run by ascending
 * `order`, ties by registration order; a negative order runs before the default-order systems.
 */
export class AbstractSystem {

    /**
     * @param {number} [order]
     */
    constructor(order = 0) {
        this.order = order;
    }

    /**
     * SUBMIT_INTENTS: submits this tick's port transfer intents.
     * @returns {void}
     */
    submitIntents() {}

    /**
     * POST_RESOLVE: reads the resolutions, with every resolved source already emptied; the
     * resolved destinations fill once the phase closes.
     * @returns {void}
     */
    postResolve() {}

    /**
     * The events that recreate this system's state in a chunk for a newly subscribed session.
     * @param {number} chunkKey
     * @returns {AbstractEvent[]}
     */
    chunkSync(chunkKey) {
        return [];
    }

    /**
     * Whether this system allows spawning `type` at (x, y).
     * @param {ObjectType} type
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @returns {boolean}
     */
    isPlacementAllowed(type, x, y, direction) {
        return true;
    }

    /**
     * A placed object was created, its footprint tracked, before its insert event.
     * @param {number} eid
     * @param {number} objectRef
     * @returns {void}
     */
    onSpawn(eid, objectRef) {}

    /**
     * A placed object is being deleted, before its entity is destroyed.
     * @param {number} eid
     * @param {number} objectRef
     * @returns {void}
     */
    onDespawn(eid, objectRef) {}

    /**
     * A placed object spawned or despawned in the chunk, after the host's chunk index is updated.
     * @param {number} chunkKey
     * @returns {void}
     */
    onChunkChanged(chunkKey) {}

    /**
     * @param {AbstractMessage} message
     * @param {number} playerRef - the acting player
     * @returns {boolean} whether the message was handled
     */
    dispatchMessage(message, playerRef) {
        return false;
    }

    /**
     * The inspect snapshot of an object this system owns, or null.
     * @param {number} objectRef
     * @returns {InspectHeartbeatEvent|null}
     */
    inspect(objectRef) {
        return null;
    }

    /**
     * Before the serializer reads the components: materializes JS-only runtime state into them.
     * @returns {void}
     */
    serialize() {}

    /**
     * After deserialize repopulated the world: rebuilds derived indexes from the restored components.
     * @returns {void}
     */
    rebuild() {}

    /**
     * The port eids this system's JS-only runtime state still references, so the port sweep keeps
     * them.
     * @returns {Iterable<number>}
     */
    getPinnedPortEids() {
        return [];
    }
}
