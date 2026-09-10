import {Direction, CONVEYS_ITEM, CONVEYS_FLUID} from "@spup/sdk";

// Gate adjacency rules, shared by sim guard/review and client placement mirror.
// `occupantAt(x, y)` resolves the SURFACE occupant to {type, direction} or null.

/**
 * Whether a transport at a gate's axis tile couples to the gate's ports.
 * @param {ObjectType} type
 * @param {Direction} direction - the transport's facing
 * @param {Direction} gateDirection
 * @param {boolean} isBehind - behind feeds the input port; front receives from the output port
 * @returns {boolean}
 */
export function canTransportsCouple(type, direction, gateDirection, isBehind) {
    if (type.conveys === CONVEYS_FLUID) {
        return true;
    }
    if (type.conveys !== CONVEYS_ITEM || direction !== gateDirection) {
        return false;
    }
    // A buried end exposes nothing, so a tunnel span never couples.
    let ports;
    if (isBehind) {
        ports = type.getSurfacePortsByKind("outputPorts");
    } else {
        ports = type.getSurfacePortsByKind("inputPorts");
    }
    return ports.length > 0;
}

/**
 * What stands on a tile, as the connection rules read it.
 * @typedef {Object} Occupant
 * @property {ObjectType} type
 * @property {Direction} direction
 */

/**
 * The transport kinds coupled to a gate at (x, y) facing `direction`.
 * @param {function(number, number): (Occupant|null)} occupantAt
 * @param {number} x
 * @param {number} y
 * @param {Direction} direction
 * @returns {{behind: number|null, front: number|null}} CONVEYS_* or null per side
 */
export function gateConnections(occupantAt, x, y, direction) {
    const dx = Direction.dx(direction);
    const dy = Direction.dy(direction);
    const kindAt = (tx, ty, isBehind) => {
        const occupant = occupantAt(tx, ty);
        if (occupant === null) {
            return null;
        }
        if (!canTransportsCouple(occupant.type, occupant.direction, direction, isBehind)) {
            return null;
        }
        return occupant.type.conveys;
    };
    return {
        behind: kindAt(x - dx, y - dy, true),
        front: kindAt(x + dx, y + dy, false),
    };
}

/**
 * Whether an adjacent gate coupled to the other kind on its other side blocks this placement.
 * @param {function(number, number): (Occupant|null)} occupantAt
 * @param {function({type: ObjectType, direction: Direction}): boolean} isGate
 * @param {ObjectType} type - the transport being placed
 * @param {number} x
 * @param {number} y
 * @param {Direction} direction - the placement facing
 * @returns {boolean}
 */
export function isPlacementBlockedByGate(occupantAt, isGate, type, x, y, direction) {
    if (type.conveys === null) {
        return false;
    }
    for (let neighbor = 0; neighbor < 4; neighbor += 1) {
        const gx = x + Direction.dx(neighbor);
        const gy = y + Direction.dy(neighbor);
        const occupant = occupantAt(gx, gy);
        if (occupant === null || !isGate(occupant)) {
            continue;
        }
        const gateDirection = occupant.direction;
        const dx = Direction.dx(gateDirection);
        const dy = Direction.dy(gateDirection);
        const isBehind = gx - dx === x && gy - dy === y;
        const isFront = gx + dx === x && gy + dy === y;
        if (!isBehind && !isFront) {
            continue;
        }
        if (!canTransportsCouple(type, direction, gateDirection, isBehind)) {
            continue;
        }
        const connections = gateConnections(occupantAt, gx, gy, gateDirection);
        const otherKind = isBehind ? connections.front : connections.behind;
        if (otherKind !== null && otherKind !== type.conveys) {
            return true;
        }
    }
    return false;
}
