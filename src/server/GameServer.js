import uWS from "uWebSockets.js";
import {SignInMessage} from "@/common/PlayerMessages.js";
import {WebSocketSession} from "@/server/WebSocketSession.js";
import {reportError} from "@/server/crashReporter.js";
import {GAME_VERSION, REGION_SIZE} from "@/common/constants.js";
import {formatBytes, formatUptime} from "@/common/util.js";
import {
    CLOSE_CODE_BAD_SIGN_IN, CLOSE_CODE_BAD_FRAME, CLOSE_CODE_SUPERSEDED, CLOSE_CODE_SERVER_SHUTDOWN,
} from "@/common/CloseCodes.js";

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_BACKPRESSURE_BYTES = 1024 * 1024;
const IDLE_TIMEOUT_S = 120;

/**
 * The uWebSockets.js front end: accepts connections, authenticates the sign-in frame, and pumps
 * decoded messages into the game. One instance per server process.
 */
export class GameServer {

    /**
     * @param {Game} game
     * @param {GameAPI} api
     * @param {JwksVerifier} jwksVerifier
     * @param {string} origin - this server's own canonical origin, checked against a token's aud
     * @param {string} name - the display name shown in the client's server directory
     */
    constructor(game, api, jwksVerifier, origin, name) {
        this._game = game;
        this._api = api;
        this._jwksVerifier = jwksVerifier;
        this._origin = origin;
        this._name = name;
        this._listenSocket = null;
        this._startedAtMs = Date.now();
        // playerId -> WebSocketSession, to kick a superseded login.
        this._sessionsByPlayer = new Map();

        this._app = uWS.App();
        this._app.get("/status", (res, req) => {
            this._onStatus(res);
        });
        // A plain-browser visit gets a text info screen instead of a failed upgrade.
        this._app.get("/*", (res, req) => {
            const host = req.getHeader("host");
            const scheme = req.getHeader("x-forwarded-proto") === "https" ? "wss" : "ws";
            res.writeHeader("Content-Type", "text/plain; charset=utf-8").end(this._infoScreen(host, scheme));
        });
        this._app.ws("/*", {
            compression: uWS.SHARED_COMPRESSOR,
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
     * @param {string} host
     * @param {number} port
     * @returns {Promise<void>} resolves once the port is bound; rejects when taken
     */
    listen(host, port) {
        return new Promise((resolve, reject) => {
            this._app.listen(host, port, listenSocket => {
                if (!listenSocket) {
                    reject(new Error(`Failed to listen on ${host}:${port}`));
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
     * Kicks every connected session with a shutdown code, so the client shows a distinct
     * "server restarting" message instead of a generic drop, then stops accepting connections.
     * @returns {void}
     */
    shutdown() {
        for (const session of [...this._sessionsByPlayer.values()]) {
            session.kick(CLOSE_CODE_SERVER_SHUTDOWN);
        }
        this.stop();
    }

    /**
     * The plain-text welcome/info screen served to browsers.
     * @private
     * @param {string} host - the request's Host header
     * @param {string} scheme - "ws" or "wss"
     * @returns {string}
     */
    _infoScreen(host, scheme) {
        const uptime = formatUptime(this._startedAtMs);
        return [
            "+==============================================+",
            "|            SHY'S POWER-UP FACTORY            |",
            "|                 Game Server                  |",
            "+==============================================+",
            "",
            `  version    : ${GAME_VERSION}`,
            `  mods       : ${this._game.modRegistry.modNames.join(", ")}`,
            `  websocket  : ${scheme}://${host}`,
            `  players    : ${this._sessionsByPlayer.size} online`,
            `  uptime     : ${uptime}`,
        ].join("\n");
    }

    /**
     * The client's server-directory listing calls this: unauthenticated, JSON, CORS-open.
     * @private
     * @param {object} res
     * @returns {void}
     */
    _onStatus(res) {
        const claimed = this._game.claims.claimedCount();
        res.cork(() => {
            res.writeHeader("Content-Type", "application/json")
                .writeHeader("Access-Control-Allow-Origin", "*")
                .end(JSON.stringify({
                    name: this._name,
                    version: GAME_VERSION,
                    online: this._sessionsByPlayer.size,
                    chunksClaimed: claimed,
                    chunksAvailable: REGION_SIZE * REGION_SIZE - claimed,
                }));
        });
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
            reportError(error, `Message dispatch failed for player ${session.playerId}`, {
                playerId: session.playerId,
                messageType: message.constructor.name,
            });
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
        const claims = this._jwksVerifier.verify(message.token, this._origin);
        if (claims === null) {
            ws.end(CLOSE_CODE_BAD_SIGN_IN);
            return;
        }
        const record = this._game.players.getOrCreate(claims.sub, claims.name);
        const superseded = this._sessionsByPlayer.get(record.playerId);
        if (superseded !== undefined) {
            // The close callback runs the usual disconnect cleanup.
            superseded.kick(CLOSE_CODE_SUPERSEDED);
        }

        const session = new WebSocketSession(this._api, ws, record.playerId);
        ws.getUserData().session = session;
        this._sessionsByPlayer.set(record.playerId, session);
        this._game.connect(session);
        console.log(`+ ${claims.name} (player ${record.playerId}, session ${session.id})`);
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
        const username = this._game.players.byId(session.playerId).username;
        console.log(`- ${username} (player ${session.playerId}, session ${session.id}, tx ${formatBytes(session.txBytes)}, rx ${formatBytes(session.rxBytes)})`);
    }
}
