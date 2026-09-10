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
        this.sessionRef = null;
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
        this.client.events.dispatch(event);
    }

    /**
     * @param {number} sessionRef
     * @returns {void}
     */
    setSessionRef(sessionRef) {
        this.sessionRef = sessionRef;
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
     * Tears down the session so it stops doing anything in the background (closing a socket,
     * canceling a reconnect retry). A no-op for sessions with nothing to close.
     * @returns {void}
     */
    disconnect() {
    }

    /**
     * @abstract
     * @returns {number}
     */
    get playerRef() {
        throw new NotImplementedError();
    }

    /**
     * Whether {@link playerRef} is safe to read yet.
     * @returns {boolean}
     */
    get hasPlayerRef() {
        return true;
    }

    /**
     * Whether this is solo play against an in-process sim, where the one player is the only one
     * there is. False for anything that could have company, so a UI hiding other-player detail
     * only does so when it is certain.
     * @returns {boolean}
     */
    get isLocal() {
        return false;
    }
}
