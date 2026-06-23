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
     * @abstract
     * @param sessionId {number}
     */
    setId(sessionId) {
        throw new NotImplementedError();
    }

    /**
     * @abstract
     * @param {AbstractMessage} message
     */
    sendMessage(message) {
        throw new NotImplementedError();
    }
}
