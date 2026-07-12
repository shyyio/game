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

// A path's items are sent as RLE runs: a run (rowId) of `length` tiles of `itemType`. The client
// keeps each path's runs and derives item positions from them; one run change shifts the whole path.

/**
 * Inserts or resizes one of a path's item runs; the client glides the moved items.
 */
export class BeltItemUpsertEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        pathId: "int64",
        rowId: "int64",
        length: "int32",
        itemType: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} pathId
     * @param {BigInt} rowId
     * @param {number} length
     * @param {number} itemType
     */
    constructor(x, y, pathId, rowId, length, itemType) {
        super(x, y);
        this.pathId = pathId;
        this.rowId = rowId;
        this.length = length;
        this.itemType = itemType;
    }
}

/**
 * Same payload as BeltItemUpsertEvent, but a re-key after a reset: the run didn't move, so the client
 * snaps the sprite in place rather than animating it.
 */
export class BeltItemSyncEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        pathId: "int64",
        rowId: "int64",
        length: "int32",
        itemType: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} pathId
     * @param {BigInt} rowId
     * @param {number} length
     * @param {number} itemType
     */
    constructor(x, y, pathId, rowId, length, itemType) {
        super(x, y);
        this.pathId = pathId;
        this.rowId = rowId;
        this.length = length;
        this.itemType = itemType;
    }
}

/**
 * Drops one of a path's item runs.
 */
export class BeltItemDeleteEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        pathId: "int64",
        rowId: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} pathId
     * @param {BigInt} rowId
     */
    constructor(x, y, pathId, rowId) {
        super(x, y);
        this.pathId = pathId;
        this.rowId = rowId;
    }
}

/**
 * Clears a path's item runs before an edit re-emits them as syncs (same drain) — an atomic swap.
 */
export class BeltItemResetEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        pathId: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} pathId
     */
    constructor(x, y, pathId) {
        super(x, y);
        this.pathId = pathId;
    }
}

