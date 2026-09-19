/**
 * A request that never reached its host: the player's network or that host is down, not a defect.
 */
export class ConnectionError extends Error {

    /**
     * @param {string} url
     */
    constructor(url) {
        super(`Could not reach ${url}`);
        this.name = "ConnectionError";
    }
}

/**
 * Requests `url`, raising a ConnectionError when the request never reached its host, so a caller
 * can tell that apart from a defect. An HTTP error status is the host answering, and comes back as
 * the response for the caller to check.
 * @param {string} url
 * @param {object} [init]
 * @returns {Promise<Response>}
 */
export async function requestUrl(url, init) {
    try {
        return await fetch(url, init);
    } catch {
        throw new ConnectionError(url);
    }
}
