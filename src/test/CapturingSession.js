// A minimal session that records the events published to it.

import {AbstractSession} from "@/common/AbstractSession.js";

export class CapturingSession extends AbstractSession {

    /**
     * @param {number} [playerId]
     */
    constructor(playerId=0) {
        super(null);
        this._playerId = playerId;
        /**
         * @type {AbstractEvent[]}
         */
        this.events = [];
    }

    /**
     * @param {number} sessionId
     * @returns {void}
     */
    setId(sessionId) {
        this.id = sessionId;
    }

    /**
     * @returns {number}
     */
    get playerId() {
        return this._playerId;
    }

    /**
     * Captures instead of forwarding to a client.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    publishEvent(event) {
        this.events.push(event);
    }
}
