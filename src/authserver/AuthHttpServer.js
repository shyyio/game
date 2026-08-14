import {randomBytes} from "node:crypto";
import {GAME_VERSION, ORIGIN_PATTERN, USERNAME_PATTERN} from "@/common/constants.js";
import {formatUptime} from "@/common/util.js";
import {AbstractHttpServer} from "@/server/AbstractHttpServer.js";

const SESSION_TOKEN_BYTES = 32;
const BEARER_PREFIX = "Bearer ";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The auth server's HTTP front end: dummy username-only login for now, no Steam OpenID yet.
 */
export class AuthHttpServer extends AbstractHttpServer {

    /**
     * @param {AccountRegistry} accounts
     * @param {SigningKeys} signingKeys
     * @param {JoinTokenService} joinTokens
     * @param {ServerDirectory} servers
     */
    constructor(accounts, signingKeys, joinTokens, servers) {
        super();
        this._accounts = accounts;
        this._signingKeys = signingKeys;
        this._joinTokens = joinTokens;
        this._servers = servers;
        this._startedAtMs = Date.now();
        // sessionToken -> {accountId, expiresAtMs}
        this._sessionsByToken = new Map();
        this._sweepTimer = setInterval(() => this._sweepExpiredSessions(), SESSION_SWEEP_INTERVAL_MS);
        this._sweepTimer.unref();

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
        // Reconnects during play: an origin-scoped token stands in for the account session, so a
        // page running mod code never has to hold a credential good for another server.
        this._app.post("/rejoin", (res, req) => {
            this._onRejoin(res);
        });
        this._app.get("/servers", (res, req) => {
            const authHeader = req.getHeader("authorization");
            this._onServers(res, authHeader);
        });
        // /join and /servers both carry an Authorization header, so browsers preflight them.
        this._app.options("/*", (res, req) => {
            res.cork(() => {
                res.writeStatus("204 No Content")
                    .writeHeader("Access-Control-Allow-Origin", "*")
                    .writeHeader("Access-Control-Allow-Methods", "GET, POST")
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
     * @returns {void}
     */
    stop() {
        super.stop();
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
        return this._infoScreenBanner("Auth Server", [
            `  version    : ${GAME_VERSION}`,
            `  http       : ${scheme}://${host}`,
            `  uptime     : ${uptime}`,
        ]);
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
                this._reject(res, "400 Bad Request", "Malformed JSON body", {cors: true});
                return;
            }
            if (typeof payload !== "object" || payload === null) {
                this._reject(res, "400 Bad Request", "Invalid request body", {cors: true});
                return;
            }
            const username = payload.username;
            if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
                this._reject(res, "400 Bad Request", "Invalid username", {cors: true});
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
            this._reject(res, "401 Unauthorized", "Missing or invalid bearer token", {cors: true});
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
                this._reject(res, "400 Bad Request", "Malformed JSON body", {cors: true});
                return;
            }
            if (typeof payload !== "object" || payload === null) {
                this._reject(res, "400 Bad Request", "Invalid request body", {cors: true});
                return;
            }
            const origin = payload.origin;
            if (typeof origin !== "string" || !ORIGIN_PATTERN.test(origin)) {
                this._reject(res, "400 Bad Request", "Invalid origin", {cors: true});
                return;
            }
            const account = this._accounts.byId(accountId);
            this._respond(res, {
                token: this._joinTokens.mint(account, origin),
                reconnect: this._joinTokens.mintReconnect(account, origin),
            });
        });
    }

    /**
     * @private
     * @param {object} res
     * @returns {void}
     */
    _onRejoin(res) {
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
                this._reject(res, "400 Bad Request", "Malformed JSON body", {cors: true});
                return;
            }
            if (typeof payload !== "object" || payload === null) {
                this._reject(res, "400 Bad Request", "Invalid request body", {cors: true});
                return;
            }
            const claims = this._joinTokens.verifyReconnect(payload.reconnect);
            if (claims === null) {
                this._reject(res, "401 Unauthorized", "Invalid or expired reconnect token", {cors: true});
                return;
            }
            let account;
            try {
                account = this._accounts.byId(claims.accountId);
            } catch (error) {
                this._reject(res, "401 Unauthorized", "Unknown account", {cors: true});
                return;
            }
            this._respond(res, {
                token: this._joinTokens.mint(account, claims.origin),
                reconnect: this._joinTokens.mintReconnect(account, claims.origin),
            });
        });
    }

    /**
     * @private
     * @param {object} res
     * @param {string|undefined} authHeader
     * @returns {void}
     */
    _onServers(res, authHeader) {
        const accountId = this._accountIdFromAuthHeader(authHeader);
        if (accountId === null) {
            this._reject(res, "401 Unauthorized", "Missing or invalid bearer token", {cors: true});
            return;
        }
        this._respond(res, {servers: this._servers.list()});
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
}
