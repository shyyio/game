import {AbstractChunkRoutedEvent, AbstractBatchEvent, AbstractEvent} from "@spup/sdk";

// Sentinel for a path feeding nothing, keeping `outPortRefs` a plain int column; per-path events use null.
const NO_OUT_PORT = 0;

export class BeltPathRecalculateEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        x: "sint32",
        y: "sint32",
        parts: "int64[]",
        outPortRef: "int64?",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number[]} parts - belt refs in path order, head last
     * @param {number|null} [outPortRef] - the path's out-port ref
     */
    constructor(x, y, parts, outPortRef=null) {
        super(x, y);
        this.parts = parts;
        this.outPortRef = outPortRef;
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
        itemTypeId: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} pathId
     * @param {number} itemId
     * @param {number} gap
     * @param {number} itemTypeId
     */
    constructor(x, y, pathId, itemId, gap, itemTypeId) {
        super(x, y);
        this.pathId = pathId;
        this.itemId = itemId;
        this.gap = gap;
        this.itemTypeId = itemTypeId;
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
        itemTypeId: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} pathId
     * @param {number} itemId
     * @param {number} gap
     * @param {number} itemTypeId
     */
    constructor(x, y, pathId, itemId, gap, itemTypeId) {
        super(x, y);
        this.pathId = pathId;
        this.itemId = itemId;
        this.gap = gap;
        this.itemTypeId = itemTypeId;
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
        upsertItemTypeIds: "int32[]",
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
        this.upsertItemTypeIds = [];
        this.deletePathIds = [];
        this.deleteItemIds = [];
    }

    /**
     * @param {number} pathId
     * @param {number} itemId
     * @param {number} gap
     * @param {number} itemTypeId
     * @returns {void}
     */
    addUpsert(pathId, itemId, gap, itemTypeId) {
        this.upsertPathIds.push(pathId);
        this.upsertItemIds.push(itemId);
        this.upsertGaps.push(gap);
        this.upsertItemTypeIds.push(itemTypeId);
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
                this.upsertItemTypeIds[i],
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
        outPortRefs: "int64[]",
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
        this.outPortRefs = [];
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number[]} parts - belt refs in path order, head last
     * @param {number|null} outPortRef
     * @returns {void}
     */
    add(x, y, parts, outPortRef) {
        this.tileX.push(x - this.originX);
        this.tileY.push(y - this.originY);
        this.partCounts.push(parts.length);
        this.parts.push(...parts);
        let wiredOutPortRef = outPortRef;
        if (outPortRef === null) {
            wiredOutPortRef = NO_OUT_PORT;
        }
        this.outPortRefs.push(wiredOutPortRef);
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
            const outPortRef = this.outPortRefs[i] === NO_OUT_PORT ? null : this.outPortRefs[i];
            events.push(new BeltPathRecalculateEvent(
                this.originX + this.tileX[i],
                this.originY + this.tileY[i],
                parts,
                outPortRef,
            ));
        }
        return events;
    }
}

/**
 * A pole-pole wire was added; also the chunk-sync payload, emitted at both endpoints' chunks.
 */
export class LogicWireSetEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        aObjectRef: "int64",
        bObjectRef: "int64",
    };

    /**
     * @param {number} x - one endpoint's tile
     * @param {number} y
     * @param {number} aObjectRef
     * @param {number} bObjectRef
     */
    constructor(x, y, aObjectRef, bObjectRef) {
        super(x, y);
        this.aObjectRef = aObjectRef;
        this.bObjectRef = bObjectRef;
    }
}

/**
 * A pole-pole wire was removed.
 */
export class LogicWireClearEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        aObjectRef: "int64",
        bObjectRef: "int64",
    };

    /**
     * @param {number} x - one endpoint's tile
     * @param {number} y
     * @param {number} aObjectRef
     * @param {number} bObjectRef
     */
    constructor(x, y, aObjectRef, bObjectRef) {
        super(x, y);
        this.aObjectRef = aObjectRef;
        this.bObjectRef = bObjectRef;
    }
}

/**
 * A terminal's network snapshot, answered directly to the requesting session: the devices wired
 * to the terminal's network (the terminal itself excluded) and the terminal's rules, both
 * parallel-array style.
 */
export class LogicSnapshotEvent extends AbstractEvent {

    static wireFields = {
        objectRef: "int64",
        linked: "int32",
        tier: "int32",
        deviceObjectRefs: "int64[]",
        deviceTypeIds: "int32[]",
        deviceTileXs: "sint32[]",
        deviceTileYs: "sint32[]",
        ruleActionDeviceIds: "int64[]",
        ruleActionKeys: "int32[]",
        ruleActionValues: "sint32[]",
        ruleSuspended: "int32[]",
        ruleConditionCounts: "int32[]",
        condKinds: "int32[]",
        condDeviceIds: "int64[]",
        condItemTypeIds: "int32[]",
        condKeys: "int32[]",
        condComparators: "int32[]",
        condValues: "sint32[]",
    };

    /**
     * @param {number} objectRef - the requested terminal
     * @param {number} linked - 1 when the terminal is wired to a pole
     * @param {number} tier
     * @param {number[]} deviceObjectRefs
     * @param {number[]} deviceTypeIds
     * @param {number[]} deviceTileXs
     * @param {number[]} deviceTileYs
     * @param {number[]} ruleActionDeviceIds
     * @param {number[]} ruleActionKeys
     * @param {number[]} ruleActionValues
     * @param {number[]} ruleSuspended - 1 where the rule is currently suspended
     * @param {number[]} ruleConditionCounts - rule i owns the next ruleConditionCounts[i] cond* entries
     * @param {number[]} condKinds
     * @param {number[]} condDeviceIds
     * @param {number[]} condItemTypeIds
     * @param {number[]} condKeys
     * @param {number[]} condComparators
     * @param {number[]} condValues
     */
    constructor(objectRef, linked, tier, deviceObjectRefs, deviceTypeIds, deviceTileXs, deviceTileYs, ruleActionDeviceIds, ruleActionKeys, ruleActionValues, ruleSuspended, ruleConditionCounts, condKinds, condDeviceIds, condItemTypeIds, condKeys, condComparators, condValues) {
        super();
        this.objectRef = objectRef;
        this.linked = linked;
        this.tier = tier;
        this.deviceObjectRefs = deviceObjectRefs;
        this.deviceTypeIds = deviceTypeIds;
        this.deviceTileXs = deviceTileXs;
        this.deviceTileYs = deviceTileYs;
        this.ruleActionDeviceIds = ruleActionDeviceIds;
        this.ruleActionKeys = ruleActionKeys;
        this.ruleActionValues = ruleActionValues;
        this.ruleSuspended = ruleSuspended;
        this.ruleConditionCounts = ruleConditionCounts;
        this.condKinds = condKinds;
        this.condDeviceIds = condDeviceIds;
        this.condItemTypeIds = condItemTypeIds;
        this.condKeys = condKeys;
        this.condComparators = condComparators;
        this.condValues = condValues;
    }
}
