export const AUTH_SERVER_URL = "https://auth.spupgame.com";

const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_TOO_MANY_REQUESTS = 429;

// Cap on silent 429 retries; beyond this the rate limit is surfaced as a normal failure.
const LOGIN_MAX_RETRIES = 5;

const STORAGE_SESSION_TOKEN = "spup.session-token";

// Set by login(); mintJoinToken bears it to each /join call, including reconnect retries long
// after SignIn.vue has unmounted. Mirrored to sessionStorage so a page reload (e.g. on /servers
// or /play) doesn't strand the tab with an unauthenticated in-memory null.
let sessionToken = sessionStorage.getItem(STORAGE_SESSION_TOKEN);

/**
 * @returns {boolean}
 */
export function hasSessionToken() {
    return sessionToken !== null && sessionToken !== "";
}

/**
 * Drops the stored session token, e.g. after the auth server rejects it as expired/invalid.
 * @returns {void}
 */
export function clearSessionToken() {
    sessionToken = null;
    sessionStorage.removeItem(STORAGE_SESSION_TOKEN);
}

class AuthFetchError extends Error {

    /**
     * @param {string} path
     * @param {number} status
     * @param {number|null} retryAfterMs - the Retry-After header's delay, or null if absent/unparseable
     */
    constructor(path, status, retryAfterMs) {
        super(`${path} failed: ${status}`);
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

/**
 * @param {Response} response
 * @returns {number|null}
 */
function retryAfterMsOf(response) {
    const header = response.headers.get("retry-after");
    if (header === null) {
        return null;
    }
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
        return Math.max(0, seconds * 1000);
    }
    const when = Date.parse(header);
    if (Number.isNaN(when)) {
        return null;
    }
    return Math.max(0, when - Date.now());
}

/**
 * @param {string} path
 * @param {object} options
 * @returns {Promise<object>}
 */
async function authFetch(path, options) {
    const response = await fetch(`${AUTH_SERVER_URL}${path}`, options);
    if (!response.ok) {
        throw new AuthFetchError(path, response.status, retryAfterMsOf(response));
    }
    return response.json();
}

/**
 * Logs in with a username, storing the session token for later join-token mints. A rate-limit
 * response carrying a Retry-After header retries silently after that delay instead of surfacing
 * an error to the caller, up to {@link LOGIN_MAX_RETRIES} times; without the header, or once
 * exhausted, the rate limit is treated as a normal failure.
 * @param {string} username
 * @returns {Promise<void>}
 */
export async function login(username) {
    for (let attempt = 0; ; attempt++) {
        try {
            const body = await authFetch("/login", {
                method: "POST",
                body: JSON.stringify({username}),
            });
            sessionToken = body.sessionToken;
            sessionStorage.setItem(STORAGE_SESSION_TOKEN, sessionToken);
            return;
        } catch (error) {
            const retryable = error instanceof AuthFetchError
                && error.status === HTTP_STATUS_TOO_MANY_REQUESTS
                && error.retryAfterMs !== null
                && attempt < LOGIN_MAX_RETRIES;
            if (!retryable) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, error.retryAfterMs));
        }
    }
}

/**
 * authFetch, bearing the stored session token; a 401 means it's expired or invalid, so it's
 * dropped rather than kept around to fail the same way on every subsequent call.
 * @param {string} path
 * @param {object} options
 * @returns {Promise<object>}
 */
async function authorizedFetch(path, options) {
    try {
        return await authFetch(path, {
            ...options,
            headers: {...options.headers, authorization: `Bearer ${sessionToken}`},
        });
    } catch (error) {
        if (error instanceof AuthFetchError && error.status === HTTP_STATUS_UNAUTHORIZED) {
            clearSessionToken();
        }
        throw error;
    }
}

/**
 * The public server directory, using the stored session token.
 * @returns {Promise<object[]>}
 */
export async function listServers() {
    const {servers} = await authorizedFetch("/servers", {method: "GET"});
    return servers;
}

/**
 * Mints a fresh short-lived join token for a server origin, using the stored session token.
 * @param {string} origin
 * @returns {Promise<string>}
 */
export async function mintJoinToken(origin) {
    const {token} = await authorizedFetch("/join", {
        method: "POST",
        body: JSON.stringify({origin}),
    });
    return token;
}
