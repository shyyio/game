import {LiveEvent} from "@/sdk/common.js";
import {
    EVENT_BELT_DELETE,
    EVENT_BELT_INSERT,
    EVENT_BELT_UPDATE,
    EVENT_BELT_PATH_RECALCULATE,
} from "./constants.js";

export class BeltPathRecalculateEvent extends LiveEvent {

    static wireFields = {
        type: "int32",
        x: "int32",
        y: "int32",
        chunk: "string",
        parts: "int64[]",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt[]} parts - Belt IDs in path order, head last
     */
    constructor(x, y, parts) {
        super(EVENT_BELT_PATH_RECALCULATE, x, y);
        this.parts = parts;
    }
}

export class BeltInsertEvent extends LiveEvent {

    static wireFields = {
        type: "int32",
        x: "int32",
        y: "int32",
        chunk: "string",
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
        super(EVENT_BELT_INSERT, x, y);
        this.id = id;
        this.direction = direction;
        this.beltType = beltType;
        this.parentX = parentX === undefined ? null : parentX;
        this.parentY = parentY === undefined ? null : parentY;
    }
}

export class BeltUpdateEvent extends LiveEvent {

    static wireFields = {
        type: "int32",
        x: "int32",
        y: "int32",
        chunk: "string",
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
        super(EVENT_BELT_UPDATE, x, y);
        this.id = id;
        this.newParentX = newParentX;
        this.newParentY = newParentY;
    }
}

export class BeltDeleteEvent extends LiveEvent {

    static wireFields = {
        type: "int32",
        x: "int32",
        y: "int32",
        chunk: "string",
        id: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     */
    constructor(x, y, id) {
        super(EVENT_BELT_DELETE, x, y);
        this.id = id;
    }
}
