import {AbstractChunkRoutedEvent} from "@/common/AbstractChunkRoutedEvent.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";

// What the client is told about transport lanes: a lane's shape whenever it is rebuilt, and the
// item rows riding it. Rows are keyed by lane id and item id; the client places an item from the
// lane's length and the gaps ahead of it, so the geometry always precedes the rows.

/**
 * A lane was built: the cells it covers, head first, and the port past its tail. A lane is never
 * edited in place, so a rebuild deletes the old one and creates the new.
 */
export class LaneCreatedEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        laneRef: "int64",
        cellObjectRefs: "int64[]",
        cellParentEdges: "int32[]",
        outputPortRef: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} laneRef
     * @param {number[]} cellObjectRefs
     * @param {Direction[]} cellParentEdges - the edge each cell is fed over, in its own frame
     * @param {number} outputPortRef
     */
    constructor(x, y, laneRef, cellObjectRefs, cellParentEdges, outputPortRef) {
        super(x, y);
        this.laneRef = laneRef;
        this.cellObjectRefs = cellObjectRefs;
        this.cellParentEdges = cellParentEdges;
        this.outputPortRef = outputPortRef;
    }
}

/**
 * Every lane in one chunk, for a subscribing session: `cellCounts[i]` cells of lane `laneRefs[i]`,
 * taken in order from the flat `cellObjectRefs`.
 */
export class LaneSyncBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        laneRefs: "int64[]",
        outputPortRefs: "int64[]",
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
        this.outputPortRefs = [];
        this.cellCounts = [];
        this.cellObjectRefs = [];
        this.cellParentEdges = [];
    }

    /**
     * @param {number} laneRef
     * @param {number[]} cellObjectRefs
     * @param {Direction[]} cellParentEdges
     * @param {number} outputPortRef
     * @returns {void}
     */
    add(laneRef, cellObjectRefs, cellParentEdges, outputPortRef) {
        this.laneRefs.push(laneRef);
        this.outputPortRefs.push(outputPortRef);
        this.cellCounts.push(cellObjectRefs.length);
        for (const objectRef of cellObjectRefs) {
            this.cellObjectRefs.push(objectRef);
        }
        for (const edge of cellParentEdges) {
            this.cellParentEdges.push(edge);
        }
    }

    /**
     * @returns {LaneCreatedEvent[]}
     */
    explode() {
        const events = [];
        let read = 0;
        for (let i = 0; i < this.laneRefs.length; i += 1) {
            const cells = this.cellObjectRefs.slice(read, read + this.cellCounts[i]);
            const edges = this.cellParentEdges.slice(read, read + this.cellCounts[i]);
            read += this.cellCounts[i];
            events.push(new LaneCreatedEvent(this.x, this.y, this.laneRefs[i], cells, edges, this.outputPortRefs[i]));
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
        birthTick: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} laneRef
     * @param {number} itemRef
     * @param {number} gap
     * @param {number} itemTypeId
     * @param {number} birthTick
     */
    constructor(x, y, laneRef, itemRef, gap, itemTypeId, birthTick) {
        super(x, y);
        this.laneRef = laneRef;
        this.itemRef = itemRef;
        this.gap = gap;
        this.itemTypeId = itemTypeId;
        this.birthTick = birthTick;
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
        birthTick: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} laneRef
     * @param {number} itemRef
     * @param {number} gap
     * @param {number} itemTypeId
     * @param {number} birthTick
     */
    constructor(x, y, laneRef, itemRef, gap, itemTypeId, birthTick) {
        super(x, y);
        this.laneRef = laneRef;
        this.itemRef = itemRef;
        this.gap = gap;
        this.itemTypeId = itemTypeId;
        this.birthTick = birthTick;
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
 * A lane was destroyed: every item drawn against it goes with it.
 */
export class LaneDeletedEvent extends AbstractChunkRoutedEvent {

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
 * One chunk's item rows for one pass, in parallel columns: upserts glide, syncs snap, deletes and
 * deleted lanes remove.
 */
export class LaneItemBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        clock: "int32",
        upsertLaneRefs: "int64[]",
        upsertItemRefs: "int32[]",
        upsertGaps: "int32[]",
        upsertItemTypeIds: "int32[]",
        upsertAges: "int32[]",
        syncLaneRefs: "int64[]",
        syncItemRefs: "int32[]",
        syncGaps: "int32[]",
        syncItemTypeIds: "int32[]",
        syncAges: "int32[]",
        deleteLaneRefs: "int64[]",
        deleteItemRefs: "int32[]",
        deletedLaneRefs: "int64[]",
    };

    /**
     * @param {number} x - a position in the batched chunk, routing the batch to that topic
     * @param {number} y
     * @param {number} clock - the tick the rows were read on, which their ages count back from
     */
    constructor(x, y, clock) {
        super(x, y);
        this.clock = clock;
        this.upsertLaneRefs = [];
        this.upsertItemRefs = [];
        this.upsertGaps = [];
        this.upsertItemTypeIds = [];
        this.upsertAges = [];
        this.syncLaneRefs = [];
        this.syncItemRefs = [];
        this.syncGaps = [];
        this.syncItemTypeIds = [];
        this.syncAges = [];
        this.deleteLaneRefs = [];
        this.deleteItemRefs = [];
        this.deletedLaneRefs = [];
    }

    /**
     * @param {number} laneRef
     * @param {number} itemRef
     * @param {number} gap
     * @param {number} itemTypeId
     * @param {number} birthTick
     * @returns {void}
     */
    addUpsert(laneRef, itemRef, gap, itemTypeId, birthTick) {
        this.upsertLaneRefs.push(laneRef);
        this.upsertItemRefs.push(itemRef);
        this.upsertGaps.push(gap);
        this.upsertItemTypeIds.push(itemTypeId);
        this.upsertAges.push(this.clock - birthTick);
    }

    /**
     * @param {number} laneRef
     * @param {number} itemRef
     * @param {number} gap
     * @param {number} itemTypeId
     * @param {number} birthTick
     * @returns {void}
     */
    addSync(laneRef, itemRef, gap, itemTypeId, birthTick) {
        this.syncLaneRefs.push(laneRef);
        this.syncItemRefs.push(itemRef);
        this.syncGaps.push(gap);
        this.syncItemTypeIds.push(itemTypeId);
        this.syncAges.push(this.clock - birthTick);
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
    addLaneDeleted(laneRef) {
        this.deletedLaneRefs.push(laneRef);
    }

    /**
     * @returns {boolean}
     */
    get isEmpty() {
        return this.upsertLaneRefs.length === 0 && this.syncLaneRefs.length === 0
            && this.deleteLaneRefs.length === 0 && this.deletedLaneRefs.length === 0;
    }

    /**
     * Deleted lanes first, then deleted items, so a row re-added in the same pass survives.
     * @returns {AbstractChunkRoutedEvent[]}
     */
    explode() {
        const events = [];
        for (const laneRef of this.deletedLaneRefs) {
            events.push(new LaneDeletedEvent(this.x, this.y, laneRef));
        }
        for (let i = 0; i < this.deleteLaneRefs.length; i += 1) {
            events.push(new LaneItemDeleteEvent(this.x, this.y, this.deleteLaneRefs[i], this.deleteItemRefs[i]));
        }
        for (let i = 0; i < this.syncLaneRefs.length; i += 1) {
            events.push(new LaneItemSyncEvent(
                this.x, this.y, this.syncLaneRefs[i], this.syncItemRefs[i], this.syncGaps[i], this.syncItemTypeIds[i],
                this.clock - this.syncAges[i],
            ));
        }
        for (let i = 0; i < this.upsertLaneRefs.length; i += 1) {
            events.push(new LaneItemUpsertEvent(
                this.x, this.y, this.upsertLaneRefs[i], this.upsertItemRefs[i], this.upsertGaps[i], this.upsertItemTypeIds[i],
                this.clock - this.upsertAges[i],
            ));
        }
        return events;
    }
}
