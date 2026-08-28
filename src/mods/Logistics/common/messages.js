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
