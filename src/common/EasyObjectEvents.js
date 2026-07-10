import {AbstractTilePositionedEvent} from "@/common/AbstractTilePositionedEvent.js";

// Generic object lifecycle events, tagged with the definition's `typeId`. `portIds` are the rendered
// out-port ids in `outputPorts.filter(render)` order (the client zips them back to names). `lastOutput`
// is the object's last produced item (0 = none), so a client can show production at a glance.

/**
 * An object the player just placed.
 */
export class EasyObjectInsertEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        typeId: "int32",
        id: "int64",
        x: "int32",
        y: "int32",
        direction: "int32",
        portIds: "int64[]",
        lastOutput: "int32?",
    };

    /**
     * @param {number} typeId
     * @param {BigInt} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {BigInt[]} portIds
     * @param {number|null} lastOutput
     */
    constructor(typeId, id, x, y, direction, portIds, lastOutput) {
        super(x, y);
        this.typeId = typeId;
        this.id = id;
        this.direction = direction;
        this.portIds = portIds;
        this.lastOutput = lastOutput;
    }
}

/**
 * An object synced into a loaded chunk; same payload as the insert but a distinct type so the client
 * skips placement feedback.
 */
export class EasyObjectSyncEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        typeId: "int32",
        id: "int64",
        x: "int32",
        y: "int32",
        direction: "int32",
        portIds: "int64[]",
        lastOutput: "int32?",
    };

    /**
     * @param {number} typeId
     * @param {BigInt} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {BigInt[]} portIds
     * @param {number|null} lastOutput
     */
    constructor(typeId, id, x, y, direction, portIds, lastOutput) {
        super(x, y);
        this.typeId = typeId;
        this.id = id;
        this.direction = direction;
        this.portIds = portIds;
        this.lastOutput = lastOutput;
    }
}

/**
 * An object the player just removed.
 */
export class EasyObjectDeleteEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        typeId: "int32",
        id: "int64",
        x: "int32",
        y: "int32",
    };

    /**
     * @param {number} typeId
     * @param {BigInt} id
     * @param {number} x
     * @param {number} y
     */
    constructor(typeId, id, x, y) {
        super(x, y);
        this.typeId = typeId;
        this.id = id;
    }
}
