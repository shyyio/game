import {AbstractMessage} from "@spup/sdk";

/**
 * Sets a placed gate's open state.
 */
export class SetGateOpenMessage extends AbstractMessage {

    static wireFields = {
        objectRef: "int64",
        open: "int32",
    };

    /**
     * @param {number} objectRef
     * @param {number} open - 1 open, 0 closed
     */
    constructor(objectRef, open) {
        super();
        this.objectRef = objectRef;
        this.open = open;
    }

    /**
     * Shape only; the target's existence and the sender's build rights are checked server-side.
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.objectRef) && (this.open === 0 || this.open === 1);
    }
}

/**
 * Adds a wire between two endpoints: pole-pole, or a wireable device and a pole.
 */
export class WireLinkMessage extends AbstractMessage {

    static wireFields = {
        aObjectRef: "int64",
        bObjectRef: "int64",
    };

    /**
     * @param {number} aObjectRef
     * @param {number} bObjectRef
     */
    constructor(aObjectRef, bObjectRef) {
        super();
        this.aObjectRef = aObjectRef;
        this.bObjectRef = bObjectRef;
    }

    /**
     * Shape only; endpoints, range, and build rights are checked server-side.
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.aObjectRef) && Number.isInteger(this.bObjectRef);
    }
}

/**
 * Removes the wire between two endpoints.
 */
export class WireUnlinkMessage extends AbstractMessage {

    static wireFields = {
        aObjectRef: "int64",
        bObjectRef: "int64",
    };

    /**
     * @param {number} aObjectRef
     * @param {number} bObjectRef
     */
    constructor(aObjectRef, bObjectRef) {
        super();
        this.aObjectRef = aObjectRef;
        this.bObjectRef = bObjectRef;
    }

    /**
     * Shape only; endpoints and build rights are checked server-side.
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.aObjectRef) && Number.isInteger(this.bObjectRef);
    }
}

/**
 * Requests a terminal's network snapshot, sent when its config panel opens.
 */
export class LogicSnapshotRequestMessage extends AbstractMessage {

    static wireFields = {
        objectRef: "int64",
    };

    /**
     * @param {number} objectRef
     */
    constructor(objectRef) {
        super();
        this.objectRef = objectRef;
    }

    /**
     * Shape only; the target's existence and type are checked server-side.
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.objectRef);
    }
}

/**
 * Replaces a terminal's whole rule list. Rules are parallel arrays (one action each); their
 * AND'ed conditions are flattened into the cond* arrays, rule `i` owning the next
 * conditionCounts[i] entries.
 */
export class ConfigureLogicRulesMessage extends AbstractMessage {

    static wireFields = {
        objectRef: "int64",
        actionDeviceIds: "int64[]",
        actionKeys: "int32[]",
        actionValues: "sint32[]",
        conditionCounts: "int32[]",
        condKinds: "int32[]",
        condDeviceIds: "int64[]",
        condItemTypeIds: "int32[]",
        condKeys: "int32[]",
        condComparators: "int32[]",
        condValues: "sint32[]",
    };

    /**
     * @param {number} objectRef
     * @param {number[]} actionDeviceIds
     * @param {number[]} actionKeys
     * @param {number[]} actionValues
     * @param {number[]} conditionCounts
     * @param {number[]} condKinds
     * @param {number[]} condDeviceIds
     * @param {number[]} condItemTypeIds
     * @param {number[]} condKeys
     * @param {number[]} condComparators
     * @param {number[]} condValues
     */
    constructor(objectRef, actionDeviceIds, actionKeys, actionValues, conditionCounts, condKinds, condDeviceIds, condItemTypeIds, condKeys, condComparators, condValues) {
        super();
        this.objectRef = objectRef;
        this.actionDeviceIds = actionDeviceIds;
        this.actionKeys = actionKeys;
        this.actionValues = actionValues;
        this.conditionCounts = conditionCounts;
        this.condKinds = condKinds;
        this.condDeviceIds = condDeviceIds;
        this.condItemTypeIds = condItemTypeIds;
        this.condKeys = condKeys;
        this.condComparators = condComparators;
        this.condValues = condValues;
    }

    /**
     * Shape only; the target, caps, and build rights are checked server-side.
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        if (!Number.isInteger(this.objectRef)) {
            return false;
        }
        const ruleColumns = [this.actionDeviceIds, this.actionKeys, this.actionValues, this.conditionCounts];
        const conditionColumns = [
            this.condKinds, this.condDeviceIds, this.condItemTypeIds,
            this.condKeys, this.condComparators, this.condValues,
        ];
        for (const column of [...ruleColumns, ...conditionColumns]) {
            if (!Array.isArray(column) || !column.every(Number.isInteger)) {
                return false;
            }
        }
        if (ruleColumns.some(column => column.length !== this.actionDeviceIds.length)) {
            return false;
        }
        const conditionTotal = this.conditionCounts.reduce((sum, count) => sum + count, 0);
        return conditionColumns.every(column => column.length === conditionTotal);
    }
}
