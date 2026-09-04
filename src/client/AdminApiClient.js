// The admin page's side of AdminRoutes' JSON API, same origin as the page, signed with the token
// the operator pasted once.

const STORAGE_TOKEN = "spup.admin-token";

/**
 * The api refused the token (or there is none): the page asks for one.
 */
export class AdminUnauthorizedError extends Error {

}

/**
 * The mod change would lose part of the world; the page shows the losses and asks.
 */
export class LoadoutChangeError extends Error {

    /**
     * @param {{objects: Array<{name: string, count: number}>, items: Array<{name: string, count: number}>}} losses
     */
    constructor(losses) {
        super("Changing these mods loses part of the world");
        this.losses = losses;
    }
}

/**
 * @returns {string|null}
 */
export function storedAdminToken() {
    return localStorage.getItem(STORAGE_TOKEN);
}

/**
 * @param {string} token
 * @returns {void}
 */
export function storeAdminToken(token) {
    localStorage.setItem(STORAGE_TOKEN, token);
}

/**
 * @param {string} path
 * @param {object} [init]
 * @returns {Promise<object>}
 */
async function call(path, init = {}) {
    const token = storedAdminToken();
    if (token === null) {
        throw new AdminUnauthorizedError("Admin token required");
    }
    const response = await fetch(`/admin/api/${path}`, Object.assign({headers: {Authorization: `Bearer ${token}`}}, init));
    if (response.status === 401) {
        throw new AdminUnauthorizedError(await response.text());
    }
    if (response.status === 409) {
        throw new LoadoutChangeError((await response.json()).losses);
    }
    if (!response.ok) {
        throw new Error(await response.text());
    }
    return await response.json();
}

/**
 * @returns {Promise<object>} saved and running configs, pinned fields, the world, and the pinned mods
 */
export function fetchAdminState() {
    return call("state");
}

/**
 * @param {object} config a ServerConfig's public JSON
 * @returns {Promise<{restart: string[]}>} the fields only a restart applies
 */
export function saveServerConfig(config) {
    return call("config", {method: "PUT", body: JSON.stringify(config)});
}

/**
 * Saves a config whose mod change loses part of the world, as the operator agreed to.
 * @param {object} config a ServerConfig's public JSON
 * @returns {Promise<{restart: string[]}>}
 */
export function convertServerConfig(config) {
    return call("config?convert=1", {method: "PUT", body: JSON.stringify(config)});
}

/**
 * Deletes the saved world and starts a fresh one on this config.
 * @param {object} config a ServerConfig's public JSON
 * @returns {Promise<{restart: string[]}>} the fields only a restart applies
 */
export function resetServerWorld(config) {
    return call("reset", {method: "POST", body: JSON.stringify(config)});
}
