// A minimal session that records the events published to it.

import {AbstractSession} from "@/common/AbstractSession.js";

export class CapturingSession extends AbstractSession {

    /**
     * @param {number} [playerRef]
     */
    constructor(playerRef=0) {
        super(null);
        this._playerRef = playerRef;
        /**
         * @type {AbstractEvent[]}
         */
        this.events = [];
    }

    /**
     * @returns {number}
     */
    get playerRef() {
        return this._playerRef;
    }

    /**
     * Captures the event.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    publishEvent(event) {
        this.events.push(event);
    }
}
