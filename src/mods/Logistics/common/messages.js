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
export class ControlSnapshotRequestMessage extends AbstractMessage {

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
