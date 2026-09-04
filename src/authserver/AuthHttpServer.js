import {GAME_VERSION, ORIGIN_PATTERN, USERNAME_PATTERN} from "@/common/constants.js";
import {formatUptime} from "@/common/util.js";
import {AbstractHttpServer, guarded, respondJson, rejectRequest, readJson} from "@/nodeservice/AbstractHttpServer.js";

const BEARER_PREFIX = "Bearer ";

/**
 * The auth server's HTTP front end: dummy username-only login for now, no Steam OpenID yet.
 */
export class AuthHttpServer extends AbstractHttpServer {

    /**
     * @param {AccountRegistry} accounts
     * @param {SigningKeys} signingKeys
     * @param {TokenService} tokens
     * @param {ServerDirectory} servers
     */
    constructor(accounts, signingKeys, tokens, servers) {
        super();
        this._accounts = accounts;
        this._signingKeys = signingKeys;
        this._tokens = tokens;
        this._servers = servers;
        this._startedAtMs = Date.now();

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
            const sessionToken = this._tokens.mintSession(account.accountId);
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
                token: this._tokens.mint(account, origin),
                reconnect: this._tokens.mintReconnect(account, origin),
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
            const claims = this._tokens.verifyReconnect(payload.reconnect);
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
                token: this._tokens.mint(account, claims.origin),
                reconnect: this._tokens.renewReconnect(claims),
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
        return this._tokens.verifySession(authHeader.slice(BEARER_PREFIX.length));
    }
}
