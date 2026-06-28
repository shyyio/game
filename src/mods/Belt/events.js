import {AbstractTilePositionedEvent} from "@/sdk/common.js";

export class BeltPathRecalculateEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        parts: "int64[]",
        outPortId: "int64?",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt[]} parts - Belt IDs in path order, head last
     * @param {BigInt|null} [outPortId] - the path's out-port id, so the client can map it to this path
     */
    constructor(x, y, parts, outPortId=null) {
        super(x, y);
        this.parts = parts;
        this.outPortId = outPortId;
    }
}

/**
 * A belt the player just placed; same payload as BeltSyncEvent but a distinct type for live reactions.
 */
export class BeltInsertEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        id: "int64",
        direction: "int32",
        beltType: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     * @param {number} direction
     * @param {number} beltType
     */
    constructor(x, y, id, direction, beltType) {
        super(x, y);
        this.id = id;
        this.direction = direction;
        this.beltType = beltType;
    }
}

/**
 * A belt synced into a loaded chunk; same payload as BeltInsertEvent but a distinct type to skip placement feedback.
 */
export class BeltSyncEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        id: "int64",
        direction: "int32",
        beltType: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     * @param {number} direction
     * @param {number} beltType
     */
    constructor(x, y, id, direction, beltType) {
        super(x, y);
        this.id = id;
        this.direction = direction;
        this.beltType = beltType;
    }
}

export class BeltDeleteEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        id: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     */
    constructor(x, y, id) {
        super(x, y);
        this.id = id;
    }
}

/**
 * A splitter the player just placed.
 */
export class SplitterInsertEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        id: "int64",
        direction: "int32",
        outPortAId: "int64",
        outPortBId: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     * @param {Direction} direction
     * @param {BigInt} outPortAId - shared output port the client maps to a render tile
     * @param {BigInt} outPortBId
     */
    constructor(x, y, id, direction, outPortAId, outPortBId) {
        super(x, y);
        this.id = id;
        this.direction = direction;
        this.outPortAId = outPortAId;
        this.outPortBId = outPortBId;
    }
}

/**
 * A splitter synced into a loaded chunk; same payload as the insert but a distinct type to skip placement feedback.
 */
export class SplitterSyncEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        id: "int64",
        direction: "int32",
        outPortAId: "int64",
        outPortBId: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     * @param {Direction} direction
     * @param {BigInt} outPortAId - shared output port the client maps to a render tile
     * @param {BigInt} outPortBId
     */
    constructor(x, y, id, direction, outPortAId, outPortBId) {
        super(x, y);
        this.id = id;
        this.direction = direction;
        this.outPortAId = outPortAId;
        this.outPortBId = outPortBId;
    }
}

export class SplitterDeleteEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        id: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     */
    constructor(x, y, id) {
        super(x, y);
        this.id = id;
    }
}
