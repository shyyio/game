/**
 * Base class for every message a session sends to the game. Subclasses declare
 * their wire format via a static `wireFields` map and may override `validate`
 * to reject malformed or unauthorized messages before they reach the game.
 */
export class Message {

    /**
     * Maps each wire-serialized field name to its protobuf spec string (see
     * common/wire.js for the spec grammar). Subclasses MUST override this; the
     * base leaves it undefined so the constructor can detect omissions.
     * @type {Object.<string, string>}
     */
    static wireFields;

    constructor() {
        if (this.constructor.wireFields === undefined) {
            throw new Error(`${this.constructor.name} extends Message but has no static wireFields`);
        }
    }

    /**
     * Returns whether this message should be accepted and dispatched. The base
     * implementation accepts everything; subclasses override to enforce limits
     * or check game/session state. Returning false silently drops the message.
     * @param {GameAPI} api
     * @param {Session} session
     * @returns {boolean}
     */
    validate(api, session) {
        return true;
    }
}
