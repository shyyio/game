import {AbstractSession} from "@/common/AbstractSession.js";
import {SignInMessage} from "@/common/PlayerMessages.js";
import {WelcomeEvent} from "@/common/PlayerEvents.js";
import {GAME_VERSION} from "@/common/constants.js";
import {CLOSE_CODE_SUPERSEDED, CLOSE_CODE_SERVER_SHUTDOWN, CLOSE_CODE_BAD_SIGN_IN, CLOSE_CODE_BAD_FRAME} from "@/common/CloseCodes.js";
import {DEV} from "@/common/env.js";
import {jwtExpiry} from "@/common/util.js";

// Backoff between reconnect attempts, capped, with jitter so many clients don't retry in lockstep.
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;
const RETRY_JITTER_MS = 500;

// A token expiring sooner than this is not worth reusing for a retry about to sign in with it.
const TOKEN_REUSE_MARGIN_S = 10;

export const SESSION_STATUS_CONNECTED = "connected";
export const SESSION_STATUS_RECONNECTING = "reconnecting";
export const SESSION_STATUS_SERVER_SHUTDOWN = "server-shutdown";
export const SESSION_STATUS_SUPERSEDED = "superseded";
export const SESSION_STATUS_REJECTED = "rejected";

// Close codes the server sends for a bad request, not a transient drop; retrying resends the same
// bad request forever, so these never retry.
const TERMINAL_CLOSE_CODES = new Set([CLOSE_CODE_SUPERSEDED, CLOSE_CODE_BAD_SIGN_IN, CLOSE_CODE_BAD_FRAME]);

/**
 * The browser side of a server connection: messages encode onto a WebSocket, decoded events feed
 * the client. No local Game exists behind it — the server owns the sim. A drop or network blip
 * retries with backoff, minting a fresh join token before each attempt (the server's are
 * short-lived); a superseded login (signed in elsewhere) never retries.
 */
export class RemoteSession extends AbstractSession {

    /**
     * @param {WireRegistry} wire
     * @param {string} url
     * @param {string} token - a signed join token from the auth server
     * @param {function(): Promise<string>} mintJoinToken - refreshes the join token before a retry
     */
    constructor(wire, url, token, mintJoinToken) {
        super(null);
        this._wire = wire;
        this._url = url;
        this._token = token;
        this._mintJoinToken = mintJoinToken;
        this._ws = null;
        this._playerId = null;
        this._onStatusChange = null;
        this._pending = [];
        this._reconnecting = false;
        this._retryAttempt = 0;
        this._retryTimer = null;
    }

    /**
     * Opens the socket and sends the sign-in; events start flowing into the client.
     * @returns {void}
     */
    connect() {
        this._open();
    }

    /**
     * Registers the connection-status callback: (status, code) -> void, fired on every
     * disconnect, retry, and reconnect.
     * @param {function(string, number=): void} callback
     * @returns {void}
     */
    onStatusChange(callback) {
        this._onStatusChange = callback;
    }

    /**
     * Retries immediately, skipping the rest of any pending backoff; a no-op when not currently
     * waiting to retry.
     * @returns {void}
     */
    retryNow() {
        if (this._retryTimer === null) {
            return;
        }
        clearTimeout(this._retryTimer);
        this._retryNow();
    }

    /**
     * @param {AbstractMessage} message
     * @returns {void}
     */
    sendMessage(message) {
        if (this._ws === null || this._ws.readyState !== WebSocket.OPEN) {
            if (this._ws !== null && this._ws.readyState === WebSocket.CONNECTING) {
                this._pending.push(message);
            }
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

    /**
     * @returns {boolean}
     */
    get hasPlayerId() {
        return this._playerId !== null;
    }

    /**
     * Dev-only: force-closes the socket to simulate a drop (network blip, server crash), so the
     * reconnect loop runs without touching the real server.
     * @returns {void}
     */
    debugDisconnect() {
        if (this._ws !== null) {
            this._ws.close();
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _open() {
        const ws = new WebSocket(this._url);
        ws.binaryType = "arraybuffer";
        ws.onopen = () => {
            const bytes = this._wire.encode(new SignInMessage(GAME_VERSION, this._token));
            this.txBytes += bytes.length;
            ws.send(bytes);
            for (const message of this._pending) {
                this.sendMessage(message);
            }
            this._pending.length = 0;
        };
        ws.onmessage = event => {
            const bytes = new Uint8Array(event.data);
            this.rxBytes += bytes.length;
            const decoded = this._wire.decode(bytes);
            if (decoded instanceof WelcomeEvent) {
                this._playerId = decoded.playerId;
                if (this._reconnecting) {
                    this._reconnecting = false;
                    this._retryAttempt = 0;
                    if (DEV) {
                        console.log("[session] reconnected");
                    }
                    this._notifyStatus(SESSION_STATUS_CONNECTED);
                }
            }
            this.client.publishEvent(decoded, bytes.length);
        };
        ws.onclose = event => this._handleClose(event.code);
        this._ws = ws;
    }

    /**
     * @private
     * @param {number} code
     * @returns {void}
     */
    _handleClose(code) {
        this._ws = null;
        if (DEV) {
            console.log(`[session] disconnected (code ${code})`);
        }
        if (code === CLOSE_CODE_SUPERSEDED) {
            this._notifyStatus(SESSION_STATUS_SUPERSEDED, code);
            return;
        }
        if (TERMINAL_CLOSE_CODES.has(code)) {
            this._notifyStatus(SESSION_STATUS_REJECTED, code);
            return;
        }
        this._reconnecting = true;
        this._retryAttempt += 1;
        if (code === CLOSE_CODE_SERVER_SHUTDOWN) {
            this._notifyStatus(SESSION_STATUS_SERVER_SHUTDOWN, code);
        } else {
            this._notifyStatus(SESSION_STATUS_RECONNECTING, code);
        }
        if (DEV) {
            console.log(`[session] reconnecting (attempt ${this._retryAttempt})`);
        }
        this._scheduleRetry();
    }

    /**
     * @private
     * @returns {void}
     */
    _scheduleRetry() {
        const backoff = Math.min(RETRY_BASE_MS * 2 ** (this._retryAttempt - 1), RETRY_MAX_MS);
        const delay = backoff + Math.random() * RETRY_JITTER_MS;
        this._retryTimer = setTimeout(() => this._retryNow(), delay);
    }

    /**
     * @private
     * @returns {Promise<void>}
     */
    async _retryNow() {
        this._retryTimer = null;
        if (!this._tokenStillValid()) {
            try {
                this._token = await this._mintJoinToken();
            } catch {
                this._scheduleRetry();
                return;
            }
        }
        this._open();
    }

    /**
     * Whether the current join token is still worth reusing, rather than minting a fresh one.
     * @private
     * @returns {boolean}
     */
    _tokenStillValid() {
        const exp = jwtExpiry(this._token);
        if (exp === null) {
            return false;
        }
        return exp - Math.floor(Date.now() / 1000) > TOKEN_REUSE_MARGIN_S;
    }

    /**
     * @private
     * @param {string} status
     * @param {number} [code]
     * @returns {void}
     */
    _notifyStatus(status, code) {
        if (this._onStatusChange !== null) {
            this._onStatusChange(status, code);
        }
    }
}
