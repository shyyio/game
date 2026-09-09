import {AbstractChunkRoutedEvent} from "@/common/AbstractChunkRoutedEvent.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";

// What the client is told about transport lanes: a lane's shape whenever it is rebuilt, and the
// item rows riding it. Rows are keyed by lane id and item id; the client places an item from the
// lane's length and the gaps ahead of it, so the geometry always precedes the rows.

/**
 * A lane's shape: the cells it covers, head first, and the port past its tail.
 */
export class LaneGeometryEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        laneRef: "int64",
        cellObjectRefs: "int64[]",
        cellParentEdges: "int32[]",
        outPortRef: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} laneRef
     * @param {number[]} cellObjectRefs
     * @param {Direction[]} cellParentEdges - the edge each cell is fed over, in its own frame
     * @param {number} outPortRef
     */
    constructor(x, y, laneRef, cellObjectRefs, cellParentEdges, outPortRef) {
        super(x, y);
        this.laneRef = laneRef;
        this.cellObjectRefs = cellObjectRefs;
        this.cellParentEdges = cellParentEdges;
        this.outPortRef = outPortRef;
    }
}

/**
 * Every lane in one chunk, for a subscribing session: `cellCounts[i]` cells of lane `laneRefs[i]`,
 * taken in order from the flat `cellObjectRefs`.
 */
export class LaneGeometryBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        laneRefs: "int64[]",
        outPortRefs: "int64[]",
        cellCounts: "int32[]",
        cellObjectRefs: "int64[]",
        cellParentEdges: "int32[]",
    };

    /**
     * @param {number} x - a position in the batched chunk, routing the batch to that topic
     * @param {number} y
     */
    constructor(x, y) {
        super(x, y);
        this.laneRefs = [];
        this.outPortRefs = [];
        this.cellCounts = [];
        this.cellObjectRefs = [];
        this.cellParentEdges = [];
    }

    /**
     * @param {number} laneRef
     * @param {number[]} cellObjectRefs
     * @param {Direction[]} cellParentEdges
     * @param {number} outPortRef
     * @returns {void}
     */
    add(laneRef, cellObjectRefs, cellParentEdges, outPortRef) {
        this.laneRefs.push(laneRef);
        this.outPortRefs.push(outPortRef);
        this.cellCounts.push(cellObjectRefs.length);
        for (const objectId of cellObjectRefs) {
            this.cellObjectRefs.push(objectId);
        }
        for (const edge of cellParentEdges) {
            this.cellParentEdges.push(edge);
        }
    }

    /**
     * @returns {LaneGeometryEvent[]}
     */
    explode() {
        const events = [];
        let read = 0;
        for (let i = 0; i < this.laneRefs.length; i += 1) {
            const cells = this.cellObjectRefs.slice(read, read + this.cellCounts[i]);
            const edges = this.cellParentEdges.slice(read, read + this.cellCounts[i]);
            read += this.cellCounts[i];
            events.push(new LaneGeometryEvent(this.x, this.y, this.laneRefs[i], cells, edges, this.outPortRefs[i]));
        }
        return events;
    }
}

/**
 * An item's current row on a lane: the client glides its sprite to the new offset.
 */
export class LaneItemUpsertEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        laneRef: "int64",
        itemRef: "int32",
        gap: "int32",
        itemTypeId: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} laneRef
     * @param {number} itemRef
     * @param {number} gap
     * @param {number} itemTypeId
     */
    constructor(x, y, laneRef, itemRef, gap, itemTypeId) {
        super(x, y);
        this.laneRef = laneRef;
        this.itemRef = itemRef;
        this.gap = gap;
        this.itemTypeId = itemTypeId;
    }
}

/**
 * The same row, snapped rather than glided: the lane was rebuilt or synced, so nothing moved.
 */
export class LaneItemSyncEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        laneRef: "int64",
        itemRef: "int32",
        gap: "int32",
        itemTypeId: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} laneRef
     * @param {number} itemRef
     * @param {number} gap
     * @param {number} itemTypeId
     */
    constructor(x, y, laneRef, itemRef, gap, itemTypeId) {
        super(x, y);
        this.laneRef = laneRef;
        this.itemRef = itemRef;
        this.gap = gap;
        this.itemTypeId = itemTypeId;
    }
}

/**
 * An item left a lane.
 */
export class LaneItemDeleteEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        laneRef: "int64",
        itemRef: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} laneRef
     * @param {number} itemRef
     */
    constructor(x, y, laneRef, itemRef) {
        super(x, y);
        this.laneRef = laneRef;
        this.itemRef = itemRef;
    }
}

/**
 * A lane is gone: drop every sprite drawn against it.
 */
export class LaneItemResetEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        laneRef: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} laneRef
     */
    constructor(x, y, laneRef) {
        super(x, y);
        this.laneRef = laneRef;
    }
}

/**
 * One chunk's item rows for one pass, in parallel columns: upserts glide, syncs snap, deletes drop.
 */
export class LaneItemBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        upsertLaneRefs: "int64[]",
        upsertItemRefs: "int32[]",
        upsertGaps: "int32[]",
        upsertItemTypeIds: "int32[]",
        syncLaneRefs: "int64[]",
        syncItemRefs: "int32[]",
        syncGaps: "int32[]",
        syncItemTypeIds: "int32[]",
        deleteLaneRefs: "int64[]",
        deleteItemRefs: "int32[]",
        resetLaneRefs: "int64[]",
    };

    /**
     * @param {number} x - a position in the batched chunk, routing the batch to that topic
     * @param {number} y
     */
    constructor(x, y) {
        super(x, y);
        this.upsertLaneRefs = [];
        this.upsertItemRefs = [];
        this.upsertGaps = [];
        this.upsertItemTypeIds = [];
        this.syncLaneRefs = [];
        this.syncItemRefs = [];
        this.syncGaps = [];
        this.syncItemTypeIds = [];
        this.deleteLaneRefs = [];
        this.deleteItemRefs = [];
        this.resetLaneRefs = [];
    }

    /**
     * @param {number} laneRef
     * @param {number} itemRef
     * @param {number} gap
     * @param {number} itemTypeId
     * @returns {void}
     */
    addUpsert(laneRef, itemRef, gap, itemTypeId) {
        this.upsertLaneRefs.push(laneRef);
        this.upsertItemRefs.push(itemRef);
        this.upsertGaps.push(gap);
        this.upsertItemTypeIds.push(itemTypeId);
    }

    /**
     * @param {number} laneRef
     * @param {number} itemRef
     * @param {number} gap
     * @param {number} itemTypeId
     * @returns {void}
     */
    addSync(laneRef, itemRef, gap, itemTypeId) {
        this.syncLaneRefs.push(laneRef);
        this.syncItemRefs.push(itemRef);
        this.syncGaps.push(gap);
        this.syncItemTypeIds.push(itemTypeId);
    }

    /**
     * @param {number} laneRef
     * @param {number} itemRef
     * @returns {void}
     */
    addDelete(laneRef, itemRef) {
        this.deleteLaneRefs.push(laneRef);
        this.deleteItemRefs.push(itemRef);
    }

    /**
     * @param {number} laneRef
     * @returns {void}
     */
    addReset(laneRef) {
        this.resetLaneRefs.push(laneRef);
    }

    /**
     * @returns {boolean}
     */
    get isEmpty() {
        return this.upsertLaneRefs.length === 0 && this.syncLaneRefs.length === 0
            && this.deleteLaneRefs.length === 0 && this.resetLaneRefs.length === 0;
    }

    /**
     * Resets first, then deletes, so a row re-added in the same pass survives.
     * @returns {AbstractChunkRoutedEvent[]}
     */
    explode() {
        const events = [];
        for (const laneRef of this.resetLaneRefs) {
            events.push(new LaneItemResetEvent(this.x, this.y, laneRef));
        }
        for (let i = 0; i < this.deleteLaneRefs.length; i += 1) {
            events.push(new LaneItemDeleteEvent(this.x, this.y, this.deleteLaneRefs[i], this.deleteItemRefs[i]));
        }
        for (let i = 0; i < this.syncLaneRefs.length; i += 1) {
            events.push(new LaneItemSyncEvent(
                this.x, this.y, this.syncLaneRefs[i], this.syncItemRefs[i], this.syncGaps[i], this.syncItemTypeIds[i],
            ));
        }
        for (let i = 0; i < this.upsertLaneRefs.length; i += 1) {
            events.push(new LaneItemUpsertEvent(
                this.x, this.y, this.upsertLaneRefs[i], this.upsertItemRefs[i], this.upsertGaps[i], this.upsertItemTypeIds[i],
            ));
        }
        return events;
    }
}
