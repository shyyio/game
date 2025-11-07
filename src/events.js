import {Direction} from "@/backend/constants.js";

export class GameEvent {

}

export class BeltInsertEvent extends GameEvent {

    /**
     * @param id {BigInt}
     * @param x {Number}
     * @param y {Number}
     * @param direction {Direction}
     * @param type {BeltType}
     * @param parentX {Number}
     * @param parentY {Number}
     */
    constructor(id, x, y, direction, type, parentX, parentY) {
        super()
        this.id = id;
        this.x = x;
        this.y = y;
        this.direction = direction;
        this.type = type;
        this.parentX = parentX;
        this.parentY = parentY;
    }
}

export class BeltDeleteEvent extends GameEvent {
    /**
     * @param id {BigInt}
     */
    constructor(id) {
        super();
        this.id = id;
    }
}

export class BeltUpdateEvent extends GameEvent {

    /**
     * @param id {BigInt}
     * @param parentX {Number}
     * @param parentY {Number}
     */
    constructor(id, parentX, parentY) {
        super();
        this.id = id;
        this.parentX = parentX;
        this.parentY = parentY;
    }
}

export class BeltPathRecalculateEvent extends GameEvent {

    /**
     * @param parts {BigInt[]}
     */
    constructor(parts) {
        super()
        this.parts = parts;
    }
}

export class BeltPathDeleteEvent extends GameEvent {
    /**
     * @param id {BigInt}
     */
    constructor(id) {
        super()
        this.id = id;
    }
}

export class BeltPathUpdateEvent extends GameEvent {
    /**
     * @param id {BigInt}
     * @param headGap {Number}
     * @param outputItem {Number}
     */
    constructor(id, headGap, outputItem) {
        super()
        this.id = id;
        this.headGap = headGap;
        this.outputItem = outputItem;
    }
}

export class BeltPathItemDeleteEvent extends GameEvent {
    /**
     * @param id {BigInt}
     */
    constructor(id) {
        super()
        this.id = id;
    }
}

export class BeltPathItemInsertEvent extends GameEvent {
    /**
     * @param pathId {BigInt}
     * @param id {BigInt}
     * @param type {ItemType}
     * @param length {Number}
     * @param flag {ItemFlag}
     */
    constructor(pathId, id, type, length, flag) {
        super();
        this.pathId = pathId;
        this.id = id;
        this.type = type;
        this.length = length;
        this.flag = flag;
    }
}

export class BeltPathItemUpdateEvent extends GameEvent {
    /**
     * @param id {BigInt}
     * @param length {Number}
     */
    constructor(id, length) {
        super();
        this.id = id;
        this.length = length;
    }
}

export class ObjectInsertEvent extends GameEvent {

    /**
     * @param name {GameObject}
     * @param id {BigInt}
     * @param x {Number}
     * @param y {Number}
     * @param direction {Direction}
     */
    constructor(name, id, x, y, direction) {
        super()
        this.name = name;
        this.id = id;
        this.x = x;
        this.y = y;
        this.direction = direction;
    }
}

export class ObjectDeleteEvent extends GameEvent {

    /**
     * @param name {GameObject}
     * @param id {BigInt}
     */
    constructor(name, id) {
        super()
        this.name = name;
        this.id = id;
    }
}
