import uWS from "uWebSockets.js";
import {AbstractHttpServer, respondJson, rejectRequest} from "@/nodeservice/AbstractHttpServer.js";
import {SignInMessage} from "@/common/PlayerMessages.js";
import {WebSocketSession} from "@/server/WebSocketSession.js";
import {reportError} from "@/server/crashReporter.js";
import {GAME_VERSION, REGION_SIZE} from "@/common/constants.js";
import {formatBytes, formatUptime} from "@/common/util.js";
import {
    CLOSE_CODE_BAD_SIGN_IN, CLOSE_CODE_BAD_FRAME, CLOSE_CODE_SUPERSEDED, CLOSE_CODE_SERVER_SHUTDOWN,
    CLOSE_CODE_LOADOUT_CHANGED,
} from "@/common/CloseCodes.js";
import {MOD_CONTENT_TYPES, extensionOf} from "@/server/ModHost.js";

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_BACKPRESSURE_BYTES = 1024 * 1024;
const IDLE_TIMEOUT_S = 120;

// Content-addressed files never change under their name.
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/**
 * The uWebSockets.js front end: accepts connections, authenticates the sign-in frame, and pumps
 * decoded messages into the current world's game. One instance per server process; the world under
 * it can be swapped. Other route hosts register on `app` before listen(), which adds the catch-alls.
 */
export class GameServer extends AbstractHttpServer {

    /**
     * @param {JwksVerifier} jwksVerifier
     * @param {string} origin - this server's own canonical origin, checked against a token's aud
     * @param {string} name - the display name shown in the client's server directory
     */
    constructor(jwksVerifier, origin, name) {
        super();
        this._world = null;
        this._jwksVerifier = jwksVerifier;
        this._origin = origin;
        this._name = name;
        this._startedAtMs = Date.now();
        // playerId -> WebSocketSession, to kick a superseded login.
        this._sessionsByPlayer = new Map();

        this.app.get("/status", (res, req) => {
            this._onStatus(res);
        });
        this.app.get("/mods/index.json", (res, req) => {
            this._onModIndex(res);
        });
        this.app.get("/mods/:name", (res, req) => {
            this._onModFile(res, req.getParameter(0));
        });
    }

    /**
     * @returns {World}
     */
    get world() {
        return this._world;
    }

    /**
     * Puts a world under the server. Every session on the previous one is kicked with a code that
     * makes its client reload and rejoin, since its mod loadout may have changed.
     * @param {World} world
     * @returns {void}
     */
    setWorld(world) {
        if (this._world !== null) {
            for (const session of [...this._sessionsByPlayer.values()]) {
                session.kick(CLOSE_CODE_LOADOUT_CHANGED);
            }
        }
        this._world = world;
    }

    /**
     * @param {string} name
     * @returns {void}
     */
    setName(name) {
        this._name = name;
    }

    /**
     * @param {string} origin
     * @returns {void}
     */
    setOrigin(origin) {
        this._origin = origin;
    }

    /**
     * @param {JwksVerifier} jwksVerifier
     * @returns {void}
     */
    setJwksVerifier(jwksVerifier) {
        this._jwksVerifier = jwksVerifier;
    }

    /**
     * @param {string} host
     * @param {number} port
     * @returns {Promise<void>}
     */
    listen(host, port) {
        // A plain-browser visit gets a text info screen instead of a failed upgrade.
        this.app.get("/*", (res, req) => {
            const host = req.getHeader("host");
            const scheme = req.getHeader("x-forwarded-proto") === "https" ? "wss" : "ws";
            res.writeHeader("Content-Type", "text/plain; charset=utf-8").end(this._infoScreen(host, scheme));
        });
        this.app.ws("/*", {
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
        return super.listen(host, port);
    }

    /**
     * @private
     * @returns {Game}
     */
    get _game() {
        return this._world.game;
    }

    /**
     * @private
     * @returns {GameAPI}
     */
    get _api() {
        return this._world.api;
    }

    /**
     * @private
     * @param {object} res
     * @returns {void}
     */
    _onModIndex(res) {
        const modHost = this._world.modHost;
        if (modHost === null) {
            rejectRequest(res, "404 Not Found", "this server runs its built-in mods", {cors: true});
            return;
        }
        res.cork(() => {
            res.writeHeader("Content-Type", "application/json")
                .writeHeader("Access-Control-Allow-Origin", "*")
                .end(modHost.indexJson);
        });
    }

    /**
     * @private
     * @param {object} res
     * @param {string} name
     * @returns {void}
     */
    _onModFile(res, name) {
        let bytes;
        if (this._world.modHost !== null) {
            bytes = this._world.modHost.fileOf(name);
        }
        if (bytes === undefined) {
            rejectRequest(res, "404 Not Found", "no such mod file", {cors: true});
            return;
        }
        res.cork(() => {
            res.writeHeader("Content-Type", MOD_CONTENT_TYPES[extensionOf(name)])
                .writeHeader("Cache-Control", IMMUTABLE_CACHE)
                .writeHeader("Access-Control-Allow-Origin", "*")
                .end(bytes);
        });
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
        return this._infoScreenBanner("Game Server", [
            `  version    : ${GAME_VERSION}`,
            `  mods       : ${this._game.modRegistry.modNames.join(", ")}`,
            `  websocket  : ${scheme}://${host}`,
            `  players    : ${this._sessionsByPlayer.size} online`,
            `  uptime     : ${formatUptime(this._startedAtMs)}`,
        ]);
    }

    /**
     * The client's server-directory listing calls this: unauthenticated, JSON, CORS-open.
     * @private
     * @param {object} res
     * @returns {void}
     */
    _onStatus(res) {
        const claimed = this._game.claims.claimedCount();
        respondJson(res, {
            name: this._name,
            version: GAME_VERSION,
            online: this._sessionsByPlayer.size,
            chunksClaimed: claimed,
            chunksAvailable: REGION_SIZE * REGION_SIZE - claimed,
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
