import {NotImplementedError} from "@/common/error.js";

/**
 * @abstract
 */
export class AbstractSession {

    /**
     * @param {GameAPI} api
     */
    constructor(api) {
        /**
         * @type {number|null}
         */
        this.id = null;
        this.api = api;

        /**
         * @type {Client|null}
         */
        this.client = null;

        /**
         * Wire bytes sent to this session; stays 0 for in-process sessions.
         * @type {number}
         */
        this.txBytes = 0;

        /**
         * Wire bytes received from this session; stays 0 for in-process sessions.
         * @type {number}
         */
        this.rxBytes = 0;
    }

    /**
     * @param {AbstractEvent} event
     */
    publishEvent(event) {
        if (this.client == null) {
            return;
        }
        this.client.publishEvent(event);
    }

    /**
     * @param sessionId {number}
     * @returns {void}
     */
    setId(sessionId) {
        this.id = sessionId;
    }

    /**
     * @abstract
     * @param {AbstractMessage} message
     * @returns {void}
     */
    sendMessage(message) {
        throw new NotImplementedError();
    }

    /**
     * @abstract
     * @returns {number}
     */
    get playerId() {
        throw new NotImplementedError();
    }
}
