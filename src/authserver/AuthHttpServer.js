import {randomBytes} from "node:crypto";
import {GAME_VERSION, ORIGIN_PATTERN, USERNAME_PATTERN} from "@/common/constants.js";
import {formatUptime} from "@/common/util.js";
import {AbstractHttpServer, guarded, respondJson, rejectRequest, readJson} from "@/nodeservice/AbstractHttpServer.js";

const SESSION_TOKEN_BYTES = 32;
const BEARER_PREFIX = "Bearer ";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
// Concurrent sessions one account may hold; a login loop evicts its own oldest rather than
// growing the session map without bound.
export const MAX_SESSIONS_PER_ACCOUNT = 8;

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
        // accountId -> that account's live session tokens, oldest first
        this._tokensByAccountId = new Map();
        this._sweepTimer = setInterval(() => this._sweepExpiredSessions(), SESSION_SWEEP_INTERVAL_MS);
        this._sweepTimer.unref();

        this._app.get("/.well-known/jwks.json", guarded(res => {
            respondJson(res, {keys: [this._signingKeys.toJwk()]});
        }));
        this._app.post("/login", guarded(res => {
            this._onLogin(res);
        }));
        this._app.post("/join", guarded((res, req) => {
            const authHeader = req.getHeader("authorization");
            this._onJoin(res, authHeader);
        }));
        // Reconnects during play: an origin-scoped token stands in for the account session, so a
        // page running mod code never has to hold a credential good for another server.
        this._app.post("/rejoin", guarded(res => {
            this._onRejoin(res);
        }));
        this._app.get("/servers", guarded((res, req) => {
            const authHeader = req.getHeader("authorization");
            this._onServers(res, authHeader);
        }));
        // /join and /servers both carry an Authorization header, so browsers preflight them.
        this._app.options("/*", guarded(res => {
            res.cork(() => {
                res.writeStatus("204 No Content")
                    .writeHeader("Access-Control-Allow-Origin", "*")
                    .writeHeader("Access-Control-Allow-Methods", "GET, POST")
                    .writeHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
                    .endWithoutBody();
            });
        }));
        this._app.get("/*", guarded((res, req) => {
            const host = req.getHeader("host");
            const scheme = req.getHeader("x-forwarded-proto") === "https" ? "https" : "http";
            res.writeHeader("Content-Type", "text/plain; charset=utf-8").end(this._infoScreen(host, scheme));
        }));
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
            this._closeSession(sessionToken);
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
                this._closeSession(token);
            }
        }
    }

    /**
     * Registers a session for `accountId`, evicting that account's oldest once it is over the cap.
     * @private
     * @param {string} sessionToken
     * @param {number} accountId
     * @returns {void}
     */
    _openSession(sessionToken, accountId) {
        this._sessionsByToken.set(sessionToken, {accountId, expiresAtMs: Date.now() + SESSION_TTL_MS});
        let tokens = this._tokensByAccountId.get(accountId);
        if (tokens === undefined) {
            tokens = [];
            this._tokensByAccountId.set(accountId, tokens);
        }
        tokens.push(sessionToken);
        while (tokens.length > MAX_SESSIONS_PER_ACCOUNT) {
            this._sessionsByToken.delete(tokens.shift());
        }
    }

    /**
     * Drops a session from both indexes.
     * @private
     * @param {string} sessionToken
     * @returns {void}
     */
    _closeSession(sessionToken) {
        const session = this._sessionsByToken.get(sessionToken);
        this._sessionsByToken.delete(sessionToken);
        const tokens = this._tokensByAccountId.get(session.accountId);
        tokens.splice(tokens.indexOf(sessionToken), 1);
        if (tokens.length === 0) {
            this._tokensByAccountId.delete(session.accountId);
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
        readJson(res, payload => {
            if (typeof payload !== "object" || payload === null) {
                rejectRequest(res, "400 Bad Request", "Invalid request body", {cors: true});
                return;
            }
            const username = payload.username;
            if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
                rejectRequest(res, "400 Bad Request", "Invalid username", {cors: true});
                return;
            }
            const account = this._accounts.getOrCreate(username);
            const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
            this._openSession(sessionToken, account.accountId);
            respondJson(res, {accountId: account.accountId, username: account.username, sessionToken});
        });
    }

    /**
     * @private
     * @param {object} res
     * @param {string|undefined} authHeader
     * @returns {void}
     */
    _onJoin(res, authHeader) {
        const accountId = this._accountIdFromAuthHeader(authHeader);
        if (accountId === null) {
            rejectRequest(res, "401 Unauthorized", "Missing or invalid bearer token", {cors: true});
            return;
        }
        readJson(res, payload => {
            if (typeof payload !== "object" || payload === null) {
                rejectRequest(res, "400 Bad Request", "Invalid request body", {cors: true});
                return;
            }
            const origin = payload.origin;
            if (typeof origin !== "string" || !ORIGIN_PATTERN.test(origin)) {
                rejectRequest(res, "400 Bad Request", "Invalid origin", {cors: true});
                return;
            }
            let account;
            try {
                account = this._accounts.byId(accountId);
            } catch (error) {
                rejectRequest(res, "401 Unauthorized", "Unknown account", {cors: true});
                return;
            }
            respondJson(res, {
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
        readJson(res, payload => {
            if (typeof payload !== "object" || payload === null) {
                rejectRequest(res, "400 Bad Request", "Invalid request body", {cors: true});
                return;
            }
            const claims = this._joinTokens.verifyReconnect(payload.reconnect);
            if (claims === null) {
                rejectRequest(res, "401 Unauthorized", "Invalid or expired reconnect token", {cors: true});
                return;
            }
            let account;
            try {
                account = this._accounts.byId(claims.accountId);
            } catch (error) {
                rejectRequest(res, "401 Unauthorized", "Unknown account", {cors: true});
                return;
            }
            respondJson(res, {
                token: this._joinTokens.mint(account, claims.origin),
                reconnect: this._joinTokens.renewReconnect(claims),
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
            rejectRequest(res, "401 Unauthorized", "Missing or invalid bearer token", {cors: true});
            return;
        }
        respondJson(res, {servers: this._servers.list()});
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
