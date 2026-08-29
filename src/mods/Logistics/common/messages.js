import {AbstractMessage} from "@spup/sdk";

/**
 * Sets a placed gate's open state.
 */
export class SetGateOpenMessage extends AbstractMessage {

    static wireFields = {
        objectId: "int64",
        open: "int32",
    };

    /**
     * @param {number} objectId
     * @param {number} open - 1 open, 0 closed
     */
    constructor(objectId, open) {
        super();
        this.objectId = objectId;
        this.open = open;
    }

    /**
     * Shape only; the target's existence and the sender's build rights are checked server-side.
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.objectId) && (this.open === 0 || this.open === 1);
    }
}

/**
 * Adds a wire between two endpoints: pole-pole, or a wireable device and a pole.
 */
export class WireLinkMessage extends AbstractMessage {

    static wireFields = {
        aObjectId: "int64",
        bObjectId: "int64",
    };

    /**
     * @param {number} aObjectId
     * @param {number} bObjectId
     */
    constructor(aObjectId, bObjectId) {
        super();
        this.aObjectId = aObjectId;
        this.bObjectId = bObjectId;
    }

    /**
     * Shape only; endpoints, range, and build rights are checked server-side.
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.aObjectId) && Number.isInteger(this.bObjectId);
    }
}

/**
 * Removes the wire between two endpoints.
 */
export class WireUnlinkMessage extends AbstractMessage {

    static wireFields = {
        aObjectId: "int64",
        bObjectId: "int64",
    };

    /**
     * @param {number} aObjectId
     * @param {number} bObjectId
     */
    constructor(aObjectId, bObjectId) {
        super();
        this.aObjectId = aObjectId;
        this.bObjectId = bObjectId;
    }

    /**
     * Shape only; endpoints and build rights are checked server-side.
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.aObjectId) && Number.isInteger(this.bObjectId);
    }
}

/**
 * Requests a terminal's network snapshot, sent when its config panel opens.
 */
export class LogicSnapshotRequestMessage extends AbstractMessage {

    static wireFields = {
        objectId: "int64",
    };

    /**
     * @param {number} objectId
     */
    constructor(objectId) {
        super();
        this.objectId = objectId;
    }

    /**
     * Shape only; the target's existence and type are checked server-side.
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.objectId);
    }
}

/**
 * Replaces a terminal's whole rule list. Rules are parallel arrays (one action each); their
 * AND'ed conditions are flattened into the cond* arrays, rule `i` owning the next
 * conditionCounts[i] entries.
 */
export class ConfigureLogicRulesMessage extends AbstractMessage {

    static wireFields = {
        objectId: "int64",
        actionDeviceIds: "int64[]",
        actionKeys: "int32[]",
        actionValues: "sint32[]",
        conditionCounts: "int32[]",
        condKinds: "int32[]",
        condDeviceIds: "int64[]",
        condItemTypes: "int32[]",
        condKeys: "int32[]",
        condComparators: "int32[]",
        condValues: "sint32[]",
    };

    /**
     * @param {number} objectId
     * @param {number[]} actionDeviceIds
     * @param {number[]} actionKeys
     * @param {number[]} actionValues
     * @param {number[]} conditionCounts
     * @param {number[]} condKinds
     * @param {number[]} condDeviceIds
     * @param {number[]} condItemTypes
     * @param {number[]} condKeys
     * @param {number[]} condComparators
     * @param {number[]} condValues
     */
    constructor(objectId, actionDeviceIds, actionKeys, actionValues, conditionCounts, condKinds, condDeviceIds, condItemTypes, condKeys, condComparators, condValues) {
        super();
        this.objectId = objectId;
        this.actionDeviceIds = actionDeviceIds;
        this.actionKeys = actionKeys;
        this.actionValues = actionValues;
        this.conditionCounts = conditionCounts;
        this.condKinds = condKinds;
        this.condDeviceIds = condDeviceIds;
        this.condItemTypes = condItemTypes;
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
        if (!Number.isInteger(this.objectId)) {
            return false;
        }
        const ruleColumns = [this.actionDeviceIds, this.actionKeys, this.actionValues, this.conditionCounts];
        const conditionColumns = [
            this.condKinds, this.condDeviceIds, this.condItemTypes,
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
