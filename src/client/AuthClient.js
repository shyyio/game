export const AUTH_SERVER_URL = "https://auth.spupgame.com";

// Set by login(); mintJoinToken bears it to each /join call, including reconnect retries long
// after SignIn.vue has unmounted.
let sessionToken = null;

/**
 * @param {string} path
 * @param {object} options
 * @returns {Promise<object>}
 */
async function authFetch(path, options) {
    const response = await fetch(`${AUTH_SERVER_URL}${path}`, options);
    if (!response.ok) {
        throw new Error(`${path} failed: ${response.status}`);
    }
    return response.json();
}

/**
 * Logs in with a username, storing the session token for later join-token mints.
 * @param {string} username
 * @returns {Promise<void>}
 */
export async function login(username) {
    const body = await authFetch("/login", {
        method: "POST",
        body: JSON.stringify({username}),
    });
    sessionToken = body.sessionToken;
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
