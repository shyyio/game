import {AbstractChunkRoutedEvent, AbstractEvent} from "@spup/sdk";

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
