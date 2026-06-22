
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
        // Round-trip through the protobuf wire format even locally, so the
        // encoding used by RemoteSession is always exercised and correct.
        const decoded = this.api.wire.decode(this.api.wire.encode(message));
        this.api.sendMessage(decoded, this);
    }

    publishEvent(event) {
        if (this.client == null) {
            return;
        }
        const decoded = this.api.wire.decode(this.api.wire.encode(event));
        this.client.publishEvent(decoded);
    }
}


