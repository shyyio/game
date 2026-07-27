import {AbstractSession} from "@/common/AbstractSession.js";
import {OutboundQueue} from "@/server/OutboundQueue.js";

/**
 * A remote player's session over a uWebSockets.js socket. Events encode synchronously and enter the
 * outbound queue — publishing never blocks the tick loop on the network.
 */
export class WebSocketSession extends AbstractSession {

    /**
     * @param {GameAPI} api
     * @param {object} ws - the uWS websocket
     * @param {number} playerId
     */
    constructor(api, ws, playerId) {
        super(api);
        this._playerId = playerId;
        this._queue = new OutboundQueue({
            send: bytes => ws.send(bytes, true),
            bufferedAmount: () => ws.getBufferedAmount(),
            cork: flushBody => ws.cork(flushBody),
            close: code => ws.end(code),
        });
        this._ws = ws;
        this._closed = false;
    }

    /**
     * @returns {number}
     */
    get playerId() {
        return this._playerId;
    }

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    publishEvent(event) {
        if (this._closed) {
            return;
        }
        const bytes = this.api.wire.encode(event);
        this.txBytes += bytes.length;
        this._queue.push(bytes);
    }

    /**
     * The uWS drain callback: resume the queue.
     * @returns {void}
     */
    onDrain() {
        this._queue.onDrain();
    }

    /**
     * Marks the socket gone (uWS close callback); no later publish touches it.
     * @returns {void}
     */
    markClosed() {
        this._closed = true;
        this._queue.markClosed();
    }

    /**
     * Force-closes the socket (a superseding login); the close callback cleans up as usual.
     * @param {number} code - an application close code
     * @returns {void}
     */
    kick(code) {
        if (this._closed) {
            return;
        }
        const ws = this._ws;
        this.markClosed();
        ws.end(code);
    }

    /**
     * Server sessions receive messages from the socket, never send them.
     * @param {AbstractMessage} message
     * @returns {void}
     */
    sendMessage(message) {
        throw new Error("A WebSocketSession does not send messages");
    }
}
