/**
 * Event-bus topic keys (internal routing only, never wired). A session subscribes to a chunk it
 * views or an object it inspects; each event publishes to the matching topic's subscribers.
 */

/**
 * @param {number} chunk
 * @returns {string}
 */
export function chunkTopic(chunk) {
    return "c" + chunk;
}

/**
 * @param {number} objectId
 * @returns {string}
 */
export function objectTopic(objectId) {
    return "o" + objectId;
}
