import {AbstractMessage} from "@/common/AbstractMessage.js";

const MAX_VIEWPORT_CHUNKS = 256;
const MAX_INSPECTED_OBJECTS = 32;

export class SetViewportMessage extends AbstractMessage {

    static wireFields = {
        chunks: "int32[]",
    };

    /**
     * @param {number[]} chunks
     */
    constructor(chunks) {
        super();
        this.chunks = chunks;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return this.chunks.length <= MAX_VIEWPORT_CHUNKS;
    }
}

/**
 * The full set of machines a session is inspecting (one per open menu); the game diffs the delta.
 */
export class SetInspectedObjectsMessage extends AbstractMessage {

    static wireFields = {
        objectIds: "int64[]",
    };

    /**
     * @param {number[]} objectIds
     */
    constructor(objectIds) {
        super();
        this.objectIds = objectIds;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return this.objectIds.length <= MAX_INSPECTED_OBJECTS;
    }
}

/**
 * Deletes a placed object by its (globally unique) id. Dispatched to every mod; each deletes
 * the object if the id is one of its own and ignores it otherwise — so a tool can remove any
 * object without knowing which mod owns it.
 */
export class DeleteObjectMessage extends AbstractMessage {

    static wireFields = {
        id: "int64",
    };

    /**
     * @param {number} id
     */
    constructor(id) {
        super();
        this.id = id;
    }
}

/**
 * Places an object of `typeId` (an ObjectType's freeze-assigned type id) at a tile. The engine's
 * PlacedObjects host spawns any derived type from it; bespoke handlers ignore ids they don't own —
 * so a tool places any simple object without a per-object message class.
 */
export class CreateObjectMessage extends AbstractMessage {

    static wireFields = {
        typeId: "int32",
        x: "int32",
        y: "int32",
        direction: "int32",
    };

    /**
     * @param {number} typeId
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     */
    constructor(typeId, x, y, direction) {
        super();
        this.typeId = typeId;
        this.x = x;
        this.y = y;
        this.direction = direction;
    }
}
