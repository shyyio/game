import uWS from "uWebSockets.js";
import {SignInMessage} from "@/common/PlayerMessages.js";
import {PlayerDirectoryEvent} from "@/common/PlayerEvents.js";
import {WebSocketSession} from "@/server/WebSocketSession.js";
import {GAME_VERSION} from "@/common/constants.js";
import {formatBytes} from "@/common/util.js";

// Application close codes (4000-4999).
const CLOSE_CODE_BAD_SIGN_IN = 4001;
const CLOSE_CODE_BAD_FRAME = 4002;
const CLOSE_CODE_SUPERSEDED = 4003;

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_BACKPRESSURE_BYTES = 1024 * 1024;
const IDLE_TIMEOUT_S = 120;
const MINUTES_PER_DAY = 24 * 60;

/**
 * The uWebSockets.js front end: accepts connections, authenticates the sign-in frame, and pumps
 * decoded messages into the game. One instance per server process.
 */
export class GameServer {

    /**
     * @param {Game} game
     * @param {GameAPI} api
     */
    constructor(game, api) {
        this._game = game;
        this._api = api;
        this._listenSocket = null;
        this._startedAtMs = Date.now();
        // playerId -> WebSocketSession, to kick a superseded login.
        this._sessionsByPlayer = new Map();

        this._app = uWS.App();
        // A plain-browser visit gets a text info screen instead of a failed upgrade.
        this._app.get("/*", (res, req) => {
            const host = req.getHeader("host");
            res.writeHeader("Content-Type", "text/plain; charset=utf-8").end(this._infoScreen(host));
        });
        this._app.ws("/*", {
            compression: uWS.DISABLED,
            maxPayloadLength: MAX_PAYLOAD_BYTES,
            maxBackpressure: MAX_BACKPRESSURE_BYTES,
            idleTimeout: IDLE_TIMEOUT_S,
            open: ws => {
                ws.getUserData().session = null;
            },
            message: (ws, arrayBuffer, isBinary) => {
                this._onFrame(ws, arrayBuffer, isBinary);
            },
            drain: ws => {
                const session = ws.getUserData().session;
                if (session !== null) {
                    session.onDrain();
                }
            },
            close: ws => {
                this._onClose(ws);
            },
        });
    }

    /**
     * @param {number} port
     * @returns {Promise<void>} resolves once the port is bound; rejects when taken
     */
    listen(port) {
        return new Promise((resolve, reject) => {
            this._app.listen(port, listenSocket => {
                if (!listenSocket) {
                    reject(new Error(`Failed to listen on port ${port}`));
                    return;
                }
                this._listenSocket = listenSocket;
                resolve();
            });
        });
    }

    /**
     * Stops accepting connections (existing sockets stay up until closed).
     * @returns {void}
     */
    stop() {
        if (this._listenSocket !== null) {
            uWS.us_listen_socket_close(this._listenSocket);
            this._listenSocket = null;
        }
    }

    /**
     * The plain-text welcome/info screen served to browsers.
     * @private
     * @param {string} host - the request's Host header
     * @returns {string}
     */
    _infoScreen(host) {
        const uptime = this._formatUptime();
        const registered = this._game.players.directory().playerIds.length;
        return [
            "+==============================================+",
            "|            SHY'S POWER-UP FACTORY            |",
            "|                 Game Server                  |",
            "+==============================================+",
            "",
            `  version    : ${GAME_VERSION}`,
            `  mods       : ${this._game.modRegistry.modNames.join(", ")}`,
            `  websocket  : ws://${host}`,
            `  players    : ${this._sessionsByPlayer.size} online, ${registered} registered`,
            `  uptime     : ${uptime}`,
        ].join("\n");
    }

    /**
     * Uptime as "1day, 23h45m", day part omitted under one day.
     * @private
     * @returns {string}
     */
    _formatUptime() {
        const totalMinutes = Math.floor((Date.now() - this._startedAtMs) / 60_000);
        const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
        const hours = Math.floor((totalMinutes % MINUTES_PER_DAY) / 60);
        const minutes = totalMinutes % 60;
        const clock = `${hours}h${String(minutes).padStart(2, "0")}m`;
        if (days === 0) {
            return clock;
        }
        return `${days}day, ${clock}`;
    }

    /**
     * @private
     * @param {object} ws
     * @param {ArrayBuffer} arrayBuffer
     * @param {boolean} isBinary
     * @returns {void}
     */
    _onFrame(ws, arrayBuffer, isBinary) {
        if (!isBinary) {
            ws.end(CLOSE_CODE_BAD_FRAME);
            return;
        }
        // A malformed frame must not take the tick loop down with it.
        let message;
        try {
            message = this._api.wire.decode(new Uint8Array(arrayBuffer));
        } catch (error) {
            ws.end(CLOSE_CODE_BAD_FRAME);
            return;
        }

        const userData = ws.getUserData();
        const signIn = userData.session === null;
        if (signIn) {
            this._authenticate(ws, message);
        } else if (message instanceof SignInMessage) {
            ws.end(CLOSE_CODE_BAD_FRAME);
            return;
        }
        const session = userData.session;
        if (session === null) {
            // The sign-in was rejected and the socket ended.
            return;
        }
        session.rxBytes += arrayBuffer.byteLength;
        if (signIn) {
            return;
        }
        // A handler throw must cost only the offending session, never the process.
        try {
            this._api.sendMessage(message, session);
        } catch (error) {
            console.error(`Message dispatch failed for player ${session.playerId}:`, error);
            ws.end(CLOSE_CODE_BAD_FRAME);
        }
    }

    /**
     * The first frame must be a valid sign-in; registers the player and connects the session.
     * @private
     * @param {object} ws
     * @param {AbstractMessage} message
     * @returns {void}
     */
    _authenticate(ws, message) {
        if (!(message instanceof SignInMessage) || !message.validate(this._api, null)) {
            ws.end(CLOSE_CODE_BAD_SIGN_IN);
            return;
        }
        const known = this._game.players.findByUsername(message.username) !== null;
        const record = this._game.players.getOrCreate(message.username);
        if (!known) {
            // A one-entry directory delta; connected clients learn the new name.
            this._game.bus.publish(new PlayerDirectoryEvent([record.playerId], [record.username]));
        }

        const superseded = this._sessionsByPlayer.get(record.playerId);
        if (superseded !== undefined) {
            // The close callback runs the usual disconnect cleanup.
            superseded.kick(CLOSE_CODE_SUPERSEDED);
        }

        const session = new WebSocketSession(this._api, ws, record.playerId);
        ws.getUserData().session = session;
        this._sessionsByPlayer.set(record.playerId, session);
        this._game.connect(session);
        console.log(`+ ${message.username} (player ${record.playerId}, session ${session.id})`);
    }

    /**
     * @private
     * @param {object} ws
     * @returns {void}
     */
    _onClose(ws) {
        const session = ws.getUserData().session;
        if (session === null) {
            return;
        }
        session.markClosed();
        if (this._sessionsByPlayer.get(session.playerId) === session) {
            this._sessionsByPlayer.delete(session.playerId);
        }
        this._game.disconnect(session.id);
        console.log(`- player ${session.playerId} (session ${session.id}, tx ${formatBytes(session.txBytes)}, rx ${formatBytes(session.rxBytes)})`);
    }
}
