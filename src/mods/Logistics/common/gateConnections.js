import {Direction, CONVEYS_ITEM, CONVEYS_FLUID} from "@spup/sdk";

// Gate adjacency rules, shared by sim guard/review and client placement mirror.
// `occupantAt(x, y)` resolves the SURFACE occupant to {type, direction} or null.

/**
 * Whether a transport at a gate's axis tile couples to the gate's ports.
 * @param {ObjectType} type
 * @param {Direction} direction - the transport's facing
 * @param {Direction} gateDirection
 * @param {boolean} behind - behind feeds the in-port; front receives from the out-port
 * @returns {boolean}
 */
export function transportCouples(type, direction, gateDirection, behind) {
    if (type.conveys === CONVEYS_FLUID) {
        return true;
    }
    if (type.conveys !== CONVEYS_ITEM || direction !== gateDirection) {
        return false;
    }
    // A buried end exposes nothing, so a tunnel span never couples.
    const ports = behind ? type.surfacePorts("outputPorts") : type.surfacePorts("inputPorts");
    return ports.length > 0;
}

/**
 * The transport kinds coupled to a gate at (x, y) facing `direction`.
 * @param {function(number, number): ({type: ObjectType, direction: Direction}|null)} occupantAt
 * @param {number} x
 * @param {number} y
 * @param {Direction} direction
 * @returns {{behind: number|null, front: number|null}} CONVEYS_* or null per side
 */
export function gateConnections(occupantAt, x, y, direction) {
    const dx = Direction.dx(direction);
    const dy = Direction.dy(direction);
    const kindAt = (tx, ty, behind) => {
        const occupant = occupantAt(tx, ty);
        if (occupant === null) {
            return null;
        }
        if (!transportCouples(occupant.type, occupant.direction, direction, behind)) {
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
 * @param {function(number, number): ({type: ObjectType, direction: Direction}|null)} occupantAt
 * @param {function({type: ObjectType, direction: Direction}): boolean} isGate
 * @param {ObjectType} type - the transport being placed
 * @param {number} x
 * @param {number} y
 * @param {Direction} direction - the placement facing
 * @returns {boolean}
 */
export function placementBlockedByGate(occupantAt, isGate, type, x, y, direction) {
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
        const behind = gx - dx === x && gy - dy === y;
        const front = gx + dx === x && gy + dy === y;
        if (!behind && !front) {
            continue;
        }
        if (!transportCouples(type, direction, gateDirection, behind)) {
            continue;
        }
        const connections = gateConnections(occupantAt, gx, gy, gateDirection);
        const otherKind = behind ? connections.front : connections.behind;
        if (otherKind !== null && otherKind !== type.conveys) {
            return true;
        }
    }
    return false;
}
