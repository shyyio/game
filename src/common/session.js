
import {DEV} from "@/env.js";

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
        // In dev, round-trip through the protobuf wire format so the encoding
        // used by RemoteSession is always exercised; skipped in production to
        // avoid the overhead for single-player.
        const outgoing = DEV ? this.api.wire.decode(this.api.wire.encode(message)) : message;
        this.api.sendMessage(outgoing, this);
    }

    publishEvent(event) {
        if (this.client == null) {
            return;
        }
        const outgoing = DEV ? this.api.wire.decode(this.api.wire.encode(event)) : event;
        this.client.publishEvent(outgoing);
    }
}


