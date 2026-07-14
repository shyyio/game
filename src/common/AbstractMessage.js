import {AbstractWireObject} from "@/common/AbstractWireObject.js";

/**
 * Base class for every message a session sends to the game.
 */
export class AbstractMessage extends AbstractWireObject {

    /**
     * Returns whether to accept and dispatch this message; false silently drops it.
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return true;
    }
}
