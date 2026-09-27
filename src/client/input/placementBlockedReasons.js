// The blocked reasons every placement tool phrases the same way; a tool's own rules add theirs.
export const BLOCKED_REASON_CANNOT_BUILD_HERE = "Can't build here";
export const BLOCKED_REASON_OCCUPIED = "Tile occupied";
export const BLOCKED_REASON_CROSSES_CHUNK = "Crosses a chunk edge";

/**
 * @param {ObjectType} type
 * @returns {string}
 */
export function getLimitReachedReason(type) {
    return `${type.label} limit reached`;
}
