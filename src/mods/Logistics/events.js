import {AbstractTilePositionedEvent, AbstractBatchEvent} from "@/sdk/common.js";

// Column sentinel for a path feeding nothing, so `outPortIds` stays a plain int column; port eids
// start at 1, and the per-path events keep using null.
const NO_OUT_PORT = 0;

export class BeltPathRecalculateEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "sint32",
        y: "sint32",
        parts: "int64[]",
        outPortId: "int64?",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number[]} parts - Belt IDs in path order, head last
     * @param {number|null} [outPortId] - the path's out-port id, so the client can map it to this path
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
        x: "sint32",
        y: "sint32",
        id: "int64",
        direction: "int32",
        beltType: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} id
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
        x: "sint32",
        y: "sint32",
        id: "int64",
        direction: "int32",
        beltType: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} id
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
        x: "sint32",
        y: "sint32",
        id: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} id
     */
    constructor(x, y, id) {
        super(x, y);
        this.id = id;
    }
}

// A path's items are sent one per item: an item (itemId) of `itemType` with `gap` empty half-tiles
// ahead of it. Positions are relative, so one item's gap change shifts every item behind it.
//
// (x, y) is the path head, carried only to route the event to its chunk topic, so it stays off the
// wire: the client places items from its own cached path, never from the event. `chunk` is therefore
// meaningless on a decoded item event.

/**
 * Inserts one of a path's items or restates its gap; the client glides the moved items.
 */
export class BeltItemUpsertEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        pathId: "int64",
        itemId: "int64",
        gap: "int32",
        itemType: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} pathId
     * @param {number} itemId
     * @param {number} gap
     * @param {number} itemType
     */
    constructor(x, y, pathId, itemId, gap, itemType) {
        super(x, y);
        this.pathId = pathId;
        this.itemId = itemId;
        this.gap = gap;
        this.itemType = itemType;
    }
}

/**
 * Same payload as BeltItemUpsertEvent, but a re-key after a reset: the item didn't move, so the client
 * snaps the sprite in place rather than animating it.
 */
export class BeltItemSyncEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        pathId: "int64",
        itemId: "int64",
        gap: "int32",
        itemType: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} pathId
     * @param {number} itemId
     * @param {number} gap
     * @param {number} itemType
     */
    constructor(x, y, pathId, itemId, gap, itemType) {
        super(x, y);
        this.pathId = pathId;
        this.itemId = itemId;
        this.gap = gap;
        this.itemType = itemType;
    }
}

/**
 * Drops one of a path's items.
 */
export class BeltItemDeleteEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        pathId: "int64",
        itemId: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} pathId
     * @param {number} itemId
     */
    constructor(x, y, pathId, itemId) {
        super(x, y);
        this.pathId = pathId;
        this.itemId = itemId;
    }
}

/**
 * Clears a path's items before an edit re-emits them as syncs (same drain) — an atomic swap.
 */
export class BeltItemResetEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        pathId: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} pathId
     */
    constructor(x, y, pathId) {
        super(x, y);
        this.pathId = pathId;
    }
}


/**
 * One chunk's item deltas for a move pass: each upsert is `upsertItemIds[i]` on path
 * `upsertPathIds[i]` now holding `upsertGaps[i]` of type `upsertItemTypes[i]`, each delete is a
 * (`deletePathIds[i]`, `deleteItemIds[i]`) pair.
 */
export class BeltItemBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        upsertPathIds: "int64[]",
        upsertItemIds: "int64[]",
        upsertGaps: "int32[]",
        upsertItemTypes: "int32[]",
        deletePathIds: "int64[]",
        deleteItemIds: "int64[]",
    };

    /**
     * @param {number} x - a path head in the batched chunk, routing the batch to that topic
     * @param {number} y
     */
    constructor(x, y) {
        super(x, y);
        this.upsertPathIds = [];
        this.upsertItemIds = [];
        this.upsertGaps = [];
        this.upsertItemTypes = [];
        this.deletePathIds = [];
        this.deleteItemIds = [];
    }

    /**
     * @param {number} pathId
     * @param {number} itemId
     * @param {number} gap
     * @param {number} itemType
     * @returns {void}
     */
    addUpsert(pathId, itemId, gap, itemType) {
        this.upsertPathIds.push(pathId);
        this.upsertItemIds.push(itemId);
        this.upsertGaps.push(gap);
        this.upsertItemTypes.push(itemType);
    }

    /**
     * @param {number} pathId
     * @param {number} itemId
     * @returns {void}
     */
    addDelete(pathId, itemId) {
        this.deletePathIds.push(pathId);
        this.deleteItemIds.push(itemId);
    }

    /**
     * Deletes come first: within a pass a path pops before it ingests, never the reverse, so this
     * replays each path's deltas in emission order.
     * @returns {(BeltItemUpsertEvent|BeltItemDeleteEvent)[]}
     */
    explode() {
        const events = [];
        for (let i = 0; i < this.deletePathIds.length; i += 1) {
            events.push(new BeltItemDeleteEvent(this.x, this.y, this.deletePathIds[i], this.deleteItemIds[i]));
        }
        for (let i = 0; i < this.upsertPathIds.length; i += 1) {
            events.push(new BeltItemUpsertEvent(
                this.x,
                this.y,
                this.upsertPathIds[i],
                this.upsertItemIds[i],
                this.upsertGaps[i],
                this.upsertItemTypes[i],
            ));
        }
        return events;
    }
}

/**
 * One chunk's belts for a sync, as packed columns: belt `i` is `ids[i]` at (`tileX[i]`, `tileY[i]`)
 * facing `directions[i]` with type `beltTypes[i]`.
 */
export class BeltSyncBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        originX: "sint32",
        originY: "sint32",
        ids: "int64[]",
        tileX: "sint32[]",
        tileY: "sint32[]",
        directions: "int32[]",
        beltTypes: "int32[]",
    };

    /**
     * @param {number} originX - the batched chunk's origin tile, which also routes the batch
     * @param {number} originY
     */
    constructor(originX, originY) {
        super(originX, originY);
        this.originX = originX;
        this.originY = originY;
        this.ids = [];
        this.tileX = [];
        this.tileY = [];
        this.directions = [];
        this.beltTypes = [];
    }

    /**
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {number} direction
     * @param {number} beltType
     * @returns {void}
     */
    add(id, x, y, direction, beltType) {
        this.ids.push(id);
        this.tileX.push(x - this.originX);
        this.tileY.push(y - this.originY);
        this.directions.push(direction);
        this.beltTypes.push(beltType);
    }

    /**
     * @returns {BeltSyncEvent[]}
     */
    explode() {
        const events = [];
        for (let i = 0; i < this.ids.length; i += 1) {
            events.push(new BeltSyncEvent(
                this.originX + this.tileX[i],
                this.originY + this.tileY[i],
                this.ids[i],
                this.directions[i],
                this.beltTypes[i],
            ));
        }
        return events;
    }
}

/**
 * One chunk's path recalcs for a sync, as packed columns: path `i` heads at (`tileX[i]`, `tileY[i]`)
 * and owns the next `partCounts[i]` entries of the flattened `parts`. `outPortIds` uses NO_OUT_PORT
 * for a path feeding nothing.
 */
export class BeltPathBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        originX: "sint32",
        originY: "sint32",
        tileX: "sint32[]",
        tileY: "sint32[]",
        partCounts: "int32[]",
        parts: "int64[]",
        outPortIds: "int64[]",
    };

    /**
     * @param {number} originX - the batched chunk's origin tile, which also routes the batch
     * @param {number} originY
     */
    constructor(originX, originY) {
        super(originX, originY);
        this.originX = originX;
        this.originY = originY;
        this.tileX = [];
        this.tileY = [];
        this.partCounts = [];
        this.parts = [];
        this.outPortIds = [];
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number[]} parts - belt ids in path order, head last
     * @param {number|null} outPortId
     * @returns {void}
     */
    add(x, y, parts, outPortId) {
        this.tileX.push(x - this.originX);
        this.tileY.push(y - this.originY);
        this.partCounts.push(parts.length);
        this.parts.push(...parts);
        this.outPortIds.push(outPortId === null ? NO_OUT_PORT : outPortId);
    }

    /**
     * @returns {BeltPathRecalculateEvent[]}
     */
    explode() {
        const events = [];
        let partAt = 0;
        for (let i = 0; i < this.tileX.length; i += 1) {
            const parts = this.parts.slice(partAt, partAt + this.partCounts[i]);
            partAt += this.partCounts[i];
            const outPortId = this.outPortIds[i] === NO_OUT_PORT ? null : this.outPortIds[i];
            events.push(new BeltPathRecalculateEvent(
                this.originX + this.tileX[i],
                this.originY + this.tileY[i],
                parts,
                outPortId,
            ));
        }
        return events;
    }
}
