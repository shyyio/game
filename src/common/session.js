
/**
 * @abstract
 */
export class Session {

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
     * @param {BufferedEvent|LiveEvent} event
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

    }

    /**
     * @abstract
     * @param {Message} message
     */
    sendMessage(message) {

    }
}

export class LocalSession extends Session {

    constructor(api) {
        super(api);
    }

    setId(sessionId) {
        this.id = sessionId;
    }

    sendMessage(message) {
        this.api.sendMessage(message, this);
    }
}


