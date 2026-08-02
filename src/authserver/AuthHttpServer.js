import {randomBytes} from "node:crypto";
import uWS from "uWebSockets.js";
import {GAME_VERSION, ORIGIN_PATTERN, USERNAME_PATTERN} from "@/common/constants.js";
import {formatUptime} from "@/common/util.js";

const SESSION_TOKEN_BYTES = 32;
const BEARER_PREFIX = "Bearer ";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The auth server's HTTP front end: dummy username-only login for now, no Steam OpenID yet.
 */
export class AuthHttpServer {

    /**
     * @param {AccountRegistry} accounts
     * @param {SigningKeys} signingKeys
     * @param {JoinTokenService} joinTokens
     */
    constructor(accounts, signingKeys, joinTokens) {
        this._accounts = accounts;
        this._signingKeys = signingKeys;
        this._joinTokens = joinTokens;
        this._listenSocket = null;
        this._startedAtMs = Date.now();
        // sessionToken -> {accountId, expiresAtMs}
        this._sessionsByToken = new Map();
        this._sweepTimer = setInterval(() => this._sweepExpiredSessions(), SESSION_SWEEP_INTERVAL_MS);
        this._sweepTimer.unref();

        this._app = uWS.App();
        this._app.get("/.well-known/jwks.json", (res, req) => {
            this._respond(res, {keys: [this._signingKeys.toJwk()]});
        });
        this._app.post("/login", (res, req) => {
            this._onLogin(res);
        });
        this._app.post("/join", (res, req) => {
            const authHeader = req.getHeader("authorization");
            this._onJoin(res, authHeader);
        });
        // /join carries an Authorization header, so browsers preflight it.
        this._app.options("/*", (res, req) => {
            res.cork(() => {
                res.writeStatus("204 No Content")
                    .writeHeader("Access-Control-Allow-Origin", "*")
                    .writeHeader("Access-Control-Allow-Methods", "POST")
                    .writeHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
                    .endWithoutBody();
            });
        });
        this._app.get("/*", (res, req) => {
            const host = req.getHeader("host");
            const scheme = req.getHeader("x-forwarded-proto") === "https" ? "https" : "http";
            res.writeHeader("Content-Type", "text/plain; charset=utf-8").end(this._infoScreen(host, scheme));
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
     * The bound port, useful when listen() was called with port 0.
     * @returns {number}
     */
    get port() {
        return uWS.us_socket_local_port(this._listenSocket);
    }

    /**
     * @returns {void}
     */
    stop() {
        if (this._listenSocket !== null) {
            uWS.us_listen_socket_close(this._listenSocket);
            this._listenSocket = null;
        }
        clearInterval(this._sweepTimer);
    }

    /**
     * The accountId behind a bearer session token, or null if unknown or expired.
     * @param {string} sessionToken
     * @returns {number|null}
     */
    accountIdForSession(sessionToken) {
        const session = this._sessionsByToken.get(sessionToken);
        if (session === undefined) {
            return null;
        }
        if (Date.now() >= session.expiresAtMs) {
            this._sessionsByToken.delete(sessionToken);
            return null;
        }
        return session.accountId;
    }

    /**
     * Drops every session token past its TTL, so long-running processes don't accumulate one
     * entry per login forever.
     * @private
     * @returns {void}
     */
    _sweepExpiredSessions() {
        const now = Date.now();
        for (const [token, session] of this._sessionsByToken) {
            if (now >= session.expiresAtMs) {
                this._sessionsByToken.delete(token);
            }
        }
    }

    /**
     * The plain-text welcome/info screen served to browsers.
     * @private
     * @param {string} host - the request's Host header
     * @param {string} scheme - "http" or "https"
     * @returns {string}
     */
    _infoScreen(host, scheme) {
        const uptime = formatUptime(this._startedAtMs);
        return [
            "+==============================================+",
            "|            SHY'S POWER-UP FACTORY            |",
            "|                 Auth Server                  |",
            "+==============================================+",
            "",
            `  version    : ${GAME_VERSION}`,
            `  http       : ${scheme}://${host}`,
            `  uptime     : ${uptime}`,
        ].join("\n");
    }

    /**
     * @private
     * @param {object} res
     * @returns {void}
     */
    _onLogin(res) {
        res.onAborted(() => {
            res.aborted = true;
        });
        this._readBody(res, body => {
            if (res.aborted) {
                return;
            }
            let payload;
            try {
                payload = JSON.parse(body);
            } catch (error) {
                this._reject(res, "400 Bad Request", "Malformed JSON body");
                return;
            }
            const username = payload.username;
            if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
                this._reject(res, "400 Bad Request", "Invalid username");
                return;
            }
            const account = this._accounts.getOrCreate(username);
            const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
            this._sessionsByToken.set(sessionToken, {accountId: account.accountId, expiresAtMs: Date.now() + SESSION_TTL_MS});
            this._respond(res, {accountId: account.accountId, username: account.username, sessionToken});
        });
    }

    /**
     * @private
     * @param {object} res
     * @param {string|undefined} authHeader
     * @returns {void}
     */
    _onJoin(res, authHeader) {
        res.onAborted(() => {
            res.aborted = true;
        });
        const accountId = this._accountIdFromAuthHeader(authHeader);
        if (accountId === null) {
            this._reject(res, "401 Unauthorized", "Missing or invalid bearer token");
            return;
        }
        this._readBody(res, body => {
            if (res.aborted) {
                return;
            }
            let payload;
            try {
                payload = JSON.parse(body);
            } catch (error) {
                this._reject(res, "400 Bad Request", "Malformed JSON body");
                return;
            }
            const origin = payload.origin;
            if (typeof origin !== "string" || !ORIGIN_PATTERN.test(origin)) {
                this._reject(res, "400 Bad Request", "Invalid origin");
                return;
            }
            const account = this._accounts.byId(accountId);
            const token = this._joinTokens.mint(account, origin);
            this._respond(res, {token});
        });
    }

    /**
     * @private
     * @param {string|undefined} authHeader
     * @returns {number|null}
     */
    _accountIdFromAuthHeader(authHeader) {
        if (typeof authHeader !== "string" || !authHeader.startsWith(BEARER_PREFIX)) {
            return null;
        }
        return this.accountIdForSession(authHeader.slice(BEARER_PREFIX.length));
    }

    /**
     * @private
     * @param {object} res
     * @param {object} body
     * @returns {void}
     */
    _respond(res, body) {
        res.cork(() => {
            res.writeHeader("Content-Type", "application/json")
                .writeHeader("Access-Control-Allow-Origin", "*")
                .end(JSON.stringify(body));
        });
    }

    /**
     * @private
     * @param {object} res
     * @param {string} status - e.g. "400 Bad Request"
     * @param {string} message
     * @returns {void}
     */
    _reject(res, status, message) {
        res.cork(() => {
            res.writeStatus(status)
                .writeHeader("Access-Control-Allow-Origin", "*")
                .end(message);
        });
    }

    /**
     * Buffers a request body and hands the full UTF-8 text to onEnd.
     * @private
     * @param {object} res
     * @param {(body: string) => void} onEnd
     * @returns {void}
     */
    _readBody(res, onEnd) {
        let buffer;
        res.onData((chunk, isLast) => {
            const piece = Buffer.from(chunk);
            if (buffer === undefined) {
                buffer = piece;
            } else {
                buffer = Buffer.concat([buffer, piece]);
            }
            if (isLast) {
                if (buffer === undefined) {
                    onEnd("");
                } else {
                    onEnd(buffer.toString("utf8"));
                }
            }
        });
    }
}
