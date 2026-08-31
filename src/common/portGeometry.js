import {rotate, tileId, tileVariantId} from "@/common/util.js";

// Where a port sits in the world and when two of them meet. The sim keys its shared edge ports on
// this, the client derives its connection rendering from it, and both read the same PortDefinitions
// off the ObjectType, so one rule answers both.

/**
 * The world placement of `port` on an object at (tileX, tileY) facing `direction`: the definition's
 * offset and local facing rotated by the placement.
 * @param {PortDefinition} port
 * @param {number} tileX
 * @param {number} tileY
 * @param {Direction} direction
 * @returns {{x: number, y: number, direction: Direction}}
 */
export function portAt(port, tileX, tileY, direction) {
    const rotated = rotate(port, direction);
    return {x: tileX + rotated.x, y: tileY + rotated.y, direction: rotated.direction};
}

/**
 * The key a producer and its consumer both resolve to: flow entering tile (x, y) going `direction`.
 * @param {number} x
 * @param {number} y
 * @param {Direction} direction
 * @returns {number}
 */
export function edgeKey(x, y, direction) {
    return tileVariantId(tileId(x, y), direction);
}
