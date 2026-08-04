export const AUTH_SERVER_URL = "https://auth.spupgame.com";

const HTTP_STATUS_TOO_MANY_REQUESTS = 429;

// Cap on silent 429 retries; beyond this the rate limit is surfaced as a normal failure.
const LOGIN_MAX_RETRIES = 5;

// Set by login(); mintJoinToken bears it to each /join call, including reconnect retries long
// after SignIn.vue has unmounted.
let sessionToken = null;

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
 * Mints a fresh short-lived join token for a server origin, using the stored session token.
 * @param {string} origin
 * @returns {Promise<string>}
 */
export async function mintJoinToken(origin) {
    const {token} = await authFetch("/join", {
        method: "POST",
        headers: {authorization: `Bearer ${sessionToken}`},
        body: JSON.stringify({origin}),
    });
    return token;
}
