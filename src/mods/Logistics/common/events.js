import {AbstractChunkRoutedEvent, AbstractBatchEvent} from "@spup/sdk";

// Sentinel for a path feeding nothing, keeping `outPortIds` a plain int column; per-path events use null.
const NO_OUT_PORT = 0;

export class BeltPathRecalculateEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        x: "sint32",
        y: "sint32",
        parts: "int64[]",
        outPortId: "int64?",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number[]} parts - belt ids in path order, head last
     * @param {number|null} [outPortId] - the path's out-port id
     */
    constructor(x, y, parts, outPortId=null) {
        super(x, y);
        this.parts = parts;
        this.outPortId = outPortId;
    }
}

// Item events: `gap` = empty half-tiles ahead of the item; positions are relative, so one gap
// change shifts every item behind it. (x, y) is the path head, routes the event to its chunk
// topic only and stays off the wire — `chunk` is meaningless on a decoded item event.

/**
 * Inserts one of a path's items or restates its gap; the client glides the moved items.
 */
export class BeltItemUpsertEvent extends AbstractChunkRoutedEvent {

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
 * BeltItemUpsertEvent payload as a re-key after a reset; the client snaps in place, not animates.
 */
export class BeltItemSyncEvent extends AbstractChunkRoutedEvent {

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
export class BeltItemDeleteEvent extends AbstractChunkRoutedEvent {

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
 * Clears a path's items before an edit re-emits them as syncs.
 */
export class BeltItemResetEvent extends AbstractChunkRoutedEvent {

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
 * One chunk's item deltas for a move pass, as parallel upsert/delete columns.
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
     * @param {number} x - a path head in the batched chunk, routes the batch to that topic
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
     * Deletes come first: a path pops before it ingests, so this replays deltas in emission order.
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
 * One chunk's path recalcs as packed columns: path `i` heads at (`tileX[i]`, `tileY[i]`) and owns
 * the next `partCounts[i]` entries of `parts`; NO_OUT_PORT marks a path feeding nothing.
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
     * @param {number} originX - the batched chunk's origin tile, also routes the batch
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
        let wiredOutPortId = outPortId;
        if (outPortId === null) {
            wiredOutPortId = NO_OUT_PORT;
        }
        this.outPortIds.push(wiredOutPortId);
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

/**
 * A gate's state changed; also the chunk-sync payload for off-default gates.
 */
export class GateSetEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        objectId: "int64",
        open: "int32",
        fluid: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} objectId
     * @param {number} open - 1 open, 0 closed
     * @param {number} fluid - 1 fluid mode, 0 item mode
     */
    constructor(x, y, objectId, open, fluid) {
        super(x, y);
        this.objectId = objectId;
        this.open = open;
        this.fluid = fluid;
    }
}

/**
 * One chunk's gate-state deltas for a tick, as parallel columns.
 */
export class GateSetBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        objectIds: "int64[]",
        opens: "int32[]",
        fluids: "int32[]",
    };

    /**
     * @param {number} x - a member gate's tile in the batched chunk, routes the batch to that topic
     * @param {number} y
     */
    constructor(x, y) {
        super(x, y);
        this.objectIds = [];
        this.opens = [];
        this.fluids = [];
    }

    /**
     * @param {number} objectId
     * @param {number} open
     * @param {number} fluid
     * @returns {void}
     */
    add(objectId, open, fluid) {
        this.objectIds.push(objectId);
        this.opens.push(open);
        this.fluids.push(fluid);
    }

    /**
     * @returns {GateSetEvent[]}
     */
    explode() {
        const events = [];
        for (let i = 0; i < this.objectIds.length; i += 1) {
            events.push(new GateSetEvent(this.x, this.y, this.objectIds[i], this.opens[i], this.fluids[i]));
        }
        return events;
    }
}
