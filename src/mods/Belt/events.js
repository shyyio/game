import {AbstractTilePositionedEvent} from "@/sdk/common.js";

export class BeltPathRecalculateEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        parts: "int64[]",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt[]} parts - Belt IDs in path order, head last
     */
    constructor(x, y, parts) {
        super(x, y);
        this.parts = parts;
    }
}

/**
 * A belt the player just placed (a live change). Carries the same payload as a
 * BeltSyncEvent, but the distinct type lets the client react differently (e.g.
 * placement feedback only for inserts).
 */
export class BeltInsertEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        id: "int64",
        direction: "int32",
        beltType: "int32",
        parentX: "int32?",
        parentY: "int32?",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     * @param {number} direction
     * @param {number} beltType
     * @param {number|null} parentX
     * @param {number|null} parentY
     */
    constructor(x, y, id, direction, beltType, parentX, parentY) {
        super(x, y);
        this.id = id;
        this.direction = direction;
        this.beltType = beltType;
        this.parentX = parentX === undefined ? null : parentX;
        this.parentY = parentY === undefined ? null : parentY;
    }
}

/**
 * A belt seeded into a freshly-loaded chunk — same payload as a BeltInsertEvent,
 * but its own type so the client can skip placement feedback (animation/sound) for
 * belts that merely came into view.
 */
export class BeltSyncEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        id: "int64",
        direction: "int32",
        beltType: "int32",
        parentX: "int32?",
        parentY: "int32?",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     * @param {number} direction
     * @param {number} beltType
     * @param {number|null} parentX
     * @param {number|null} parentY
     */
    constructor(x, y, id, direction, beltType, parentX, parentY) {
        super(x, y);
        this.id = id;
        this.direction = direction;
        this.beltType = beltType;
        this.parentX = parentX === undefined ? null : parentX;
        this.parentY = parentY === undefined ? null : parentY;
    }
}

export class BeltUpdateEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
        id: "int64",
        newParentX: "int32?",
        newParentY: "int32?",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     * @param {number|null} newParentX
     * @param {number|null} newParentY
     */
    constructor(x, y, id, newParentX, newParentY) {
        super(x, y);
        this.id = id;
        this.newParentX = newParentX;
        this.newParentY = newParentY;
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
