/**
 * Base class for every message a session sends to the game.
 */
export class AbstractMessage {

    /**
     * Maps each wire-serialized field name to its protobuf spec string; subclasses MUST override.
     * @type {Object.<string, string>}
     */
    static wireFields;

    constructor() {
        if (this.constructor.wireFields === undefined) {
            throw new Error(`${this.constructor.name} extends AbstractMessage but has no static wireFields`);
        }
    }

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
