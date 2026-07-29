import {AbstractSession} from "@/common/AbstractSession.js";
import {SignInMessage} from "@/common/PlayerMessages.js";
import {WelcomeEvent} from "@/common/PlayerEvents.js";
import {GAME_VERSION} from "@/common/constants.js";

/**
 * The browser side of a server connection: messages encode onto a WebSocket, decoded events feed
 * the client. No local Game exists behind it — the server owns the sim.
 */
export class RemoteSession extends AbstractSession {

    /**
     * @param {WireRegistry} wire
     * @param {string} url
     * @param {string} username
     */
    constructor(wire, url, username) {
        super(null);
        this._wire = wire;
        this._url = url;
        this._username = username;
        this._ws = null;
        this._playerId = null;
        this._onClose = null;
    }

    /**
     * Opens the socket and sends the sign-in; events start flowing into the client.
     * @returns {void}
     */
    connect() {
        const ws = new WebSocket(this._url);
        ws.binaryType = "arraybuffer";
        ws.onopen = () => {
            const bytes = this._wire.encode(new SignInMessage(GAME_VERSION, this._username));
            this.txBytes += bytes.length;
            ws.send(bytes);
        };
        ws.onmessage = event => {
            const bytes = new Uint8Array(event.data);
            this.rxBytes += bytes.length;
            const decoded = this._wire.decode(bytes);
            if (decoded instanceof WelcomeEvent) {
                this._playerId = decoded.playerId;
            }
            this.client.publishEvent(decoded, bytes.length);
        };
        ws.onclose = event => {
            if (this._onClose !== null) {
                this._onClose(event.code);
            }
        };
        this._ws = ws;
    }

    /**
     * Registers the disconnect callback (code -> void).
     * @param {function(number): void} callback
     * @returns {void}
     */
    onClose(callback) {
        this._onClose = callback;
    }

    /**
     * @param {AbstractMessage} message
     * @returns {void}
     */
    sendMessage(message) {
        if (this._ws === null || this._ws.readyState !== WebSocket.OPEN) {
            return;
        }
        const bytes = this._wire.encode(message);
        this.txBytes += bytes.length;
        this._ws.send(bytes);
    }

    /**
     * @returns {number}
     */
    get playerId() {
        if (this._playerId === null) {
            throw new Error("playerId read before the server's welcome");
        }
        return this._playerId;
    }
}
