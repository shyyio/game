import {Direction, rotate, OCCUPANCY_LAYER_SURFACE} from "@/sdk/common.js";
import {SplitterDefinition} from "./definitions.js";
import {
    BeltType,
    BELT_RAMP_DOWN,
    BELT_RAMP_UP,
    BELT_UNDERGROUND,
    MAX_UNDERGROUND_LENGTH,
    OCCUPANCY_LAYER_UNDERGROUND_BASE,
    OccupantKind,
} from "./constants.js";

/**
 * Whether a surface occupant feeds a belt placed downstream of it: a normal belt, a ramp exit,
 * or any splitter cell (its output port). Ramp entrances and undergrounds do not feed forward.
 * @param {object} data - an occupant record's data
 * @returns {boolean}
 */
function isBeltParentSource(data) {
    if (data.kind === OccupantKind.SPLITTER) {
        return true;
    }
    return data.kind === OccupantKind.BELT
        && (data.type === BeltType.NORMAL || data.type === BeltType.RAMP_UP);
}

/**
 * The tile a belt at (tileX, tileY) facing `direction` is fed from, inferred from the shared
 * cache — or {parentX: null, parentY: null} if nothing feeds it. Mirrors the server's
 * upstreamParentSql: the highest-id feeder pointing into this tile wins, checking the tile
 * behind (a straight feed) and the two perpendicular tiles (a bend). A feeder is a normal belt
 * or ramp exit facing this way, or a splitter cell whose output lands here.
 * @param {ClientCache} cache
 * @param {number} tileX
 * @param {number} tileY
 * @param {Direction} direction
 * @returns {{parentX: number|null, parentY: number|null}}
 */
export function inferBeltParent(cache, tileX, tileY, direction) {
    const candidates = [
        {x: tileX - Direction.dx(direction), y: tileY - Direction.dy(direction), facing: direction},
    ];
    [Direction.rotate(direction, 1), Direction.rotate(direction, 3)].forEach(perpendicular => {
        candidates.push({
            x: tileX + Direction.dx(perpendicular),
            y: tileY + Direction.dy(perpendicular),
            facing: Direction.invert(perpendicular),
        });
    });

    let parent = null;
    candidates.forEach(candidate => {
        const occupant = cache.at(candidate.x, candidate.y, OCCUPANCY_LAYER_SURFACE);
        if (occupant === null || occupant.data.direction !== candidate.facing) {
            return;
        }
        if (!isBeltParentSource(occupant.data)) {
            return;
        }
        if (parent === null || occupant.id > parent.id) {
            parent = {id: occupant.id, x: candidate.x, y: candidate.y};
        }
    });

    if (parent === null) {
        return {parentX: null, parentY: null};
    }
    return {parentX: parent.x, parentY: parent.y};
}

/**
 * The occupancy layer a belt of `type` facing `direction` sits on: undergrounds get one
 * layer per axis (so crossing tunnels and a surface belt coexist), everything else SURFACE.
 * @param {BeltType} type
 * @param {Direction} direction
 * @returns {number}
 */
export function beltOccupancyLayer(type, direction) {
    if (type === BELT_UNDERGROUND) {
        return OCCUPANCY_LAYER_UNDERGROUND_BASE + (direction % 2);
    }
    return OCCUPANCY_LAYER_SURFACE;
}

/**
 * The surface (non-underground) belt record at a tile, or null. Other object kinds (splitters)
 * sharing the index are ignored.
 * @param {ClientCache} index
 * @param {number} tileX
 * @param {number} tileY
 * @returns {object|null}
 */
export function surfaceBeltAt(index, tileX, tileY) {
    const records = index.getAtTile(tileX, tileY);
    const surface = records.find(record =>
        record.data.kind === OccupantKind.BELT && record.data.type !== BELT_UNDERGROUND);
    return surface === undefined ? null : surface;
}

/**
 * The two tiles a splitter placed at (x, y) facing `direction` occupies: its base tile
 * and the far cell, its definition's size offset rotated by the facing.
 * @param {number} x
 * @param {number} y
 * @param {Direction} direction
 * @returns {{x: number, y: number}[]}
 */
export function splitterFootprint(x, y, direction) {
    const far = rotate(SplitterDefinition.size, direction);
    return [
        {x, y},
        {x: x + far.x, y: y + far.y},
    ];
}

/**
 * The render tile for each of a splitter's output ports (in out_port_a, out_port_b order):
 * the tile just past the splitter's output edge, with sourceDir pointing back at the splitter
 * (the edge the item popped from). Used to draw items resting in the shared output ports.
 * @param {number} x
 * @param {number} y
 * @param {Direction} direction
 * @returns {{tileX: number, tileY: number, sourceDir: Direction}[]}
 */
export function splitterOutputTiles(x, y, direction) {
    return SplitterDefinition.outputPorts.map(port => {
        const offset = rotate(port, direction);
        return {
            tileX: x + offset.x,
            tileY: y + offset.y,
            sourceDir: Direction.invert(direction),
        };
    });
}

// Items flow through a splitter in its facing, so both belts move the same way: the output
// (front edge) is the top-up stub, the input (back edge) the bottom-up stub, and the whole
// thing is rotated by the facing (an UP splitter draws them unrotated).
const SPLITTER_OUTPUT_CONNECTION = "machine-connection-top-up";
const SPLITTER_INPUT_CONNECTION = "machine-connection-bottom-up";

/**
 * The four external connection points of a splitter at (x, y): for each footprint cell, an
 * output (along the facing) and an input (opposite). `neighborX/Y` is the tile a connecting
 * object occupies (tested for a connection); `tileX/Y` is the splitter cell the stub draws on;
 * `base`/`angle` are the connection sprite and its rotation; `isOutput` distinguishes the two.
 * @param {number} x
 * @param {number} y
 * @param {Direction} direction
 * @returns {{key: string, base: string, angle: number, isOutput: boolean, tileX: number, tileY: number, neighborX: number, neighborY: number}[]}
 */
export function splitterConnections(x, y, direction) {
    const dx = Direction.dx(direction);
    const dy = Direction.dy(direction);
    const angle = Direction.angle(direction);
    const specs = [];
    splitterFootprint(x, y, direction).forEach((cell, i) => {
        specs.push({
            key: `out_${i}`,
            base: SPLITTER_OUTPUT_CONNECTION,
            angle,
            isOutput: true,
            tileX: cell.x,
            tileY: cell.y,
            neighborX: cell.x + dx,
            neighborY: cell.y + dy,
        });
        specs.push({
            key: `in_${i}`,
            base: SPLITTER_INPUT_CONNECTION,
            angle,
            isOutput: false,
            tileX: cell.x,
            tileY: cell.y,
            neighborX: cell.x - dx,
            neighborY: cell.y - dy,
        });
    });
    return specs;
}

/**
 * Walks `ramp`'s tunnel along its axis, returning the buried tiles passed and the
 * paired opposite ramp record (or null for a lone ramp).
 * @param {ClientCache} index
 * @param {object} ramp
 * @returns {{tiles: {x: number, y: number}[], pair: object|null}}
 */
export function walkTunnel(index, ramp) {
    const {dx, dy} = tunnelStep(ramp.data.type, ramp.data.direction);
    const pairType = ramp.data.type === BELT_RAMP_UP ? BELT_RAMP_DOWN : BELT_RAMP_UP;

    let x = ramp.tileX;
    let y = ramp.tileY;
    const tiles = [];
    for (let i = 0; i < MAX_UNDERGROUND_LENGTH + 1; i += 1) {
        x += dx;
        y += dy;
        const records = index.getAtTile(x, y);
        // Match this tunnel's own underground, not a crossing one sharing the tile:
        // a tunnel's undergrounds face the same direction as its ramps.
        const underground = records.find(record =>
            record.data.type === BELT_UNDERGROUND && record.data.direction === ramp.data.direction
        );
        if (underground !== undefined) {
            tiles.push({x, y});
            continue;
        }
        const pair = records.find(record =>
            record.data.type === pairType && record.data.direction === ramp.data.direction
        );
        return {tiles, pair: pair === undefined ? null : pair};
    }
    return {tiles, pair: null};
}

// ---- Underground belt helpers ----

/**
 * The per-step (dx, dy) for walking a ramp's tunnel (a RAMP_UP steps against its facing, a RAMP_DOWN along it).
 * @param {number} rampType BELT_RAMP_UP or BELT_RAMP_DOWN
 * @param {Direction} direction the ramp's facing
 * @returns {{dx: number, dy: number}}
 */
export function tunnelStep(rampType, direction) {
    const sign = rampType === BELT_RAMP_UP ? -1 : 1;
    return {dx: sign * Direction.dx(direction), dy: sign * Direction.dy(direction)};
}

/**
 * @param rampParent {{x: number, y: number, type: number, direction: Direction}}
 * @param options {{x: number, y: number, type: number, direction: Direction}}
 * @returns {{x: number, y: number}[]}
 */
export function getUndergroundBeltsToCreate(rampParent, options) {
    if (rampParent === null || rampParent.direction !== options.direction
        || (rampParent.type !== BELT_RAMP_DOWN && rampParent.type !== BELT_RAMP_UP)
        || (rampParent.x !== options.x && rampParent.y !== options.y)) {
        throw new Error("Invalid ramp parent for underground belt creation");
    }

    const x1 = rampParent.type === BELT_RAMP_UP ? options.x : rampParent.x;
    const y1 = rampParent.type === BELT_RAMP_UP ? options.y : rampParent.y;
    let x2 = rampParent.type === BELT_RAMP_UP ? rampParent.x : options.x;
    let y2 = rampParent.type === BELT_RAMP_UP ? rampParent.y : options.y;

    const dx = x2 === x1 ? 0 : x2 < x1 ? -1 : 1;
    const dy = y2 === y1 ? 0 : y2 < y1 ? -1 : 1;

    x2 -= dx;
    y2 -= dy;

    let x = x1;
    let y = y1;

    const undergrounds = [];
    while (x !== x2 || y !== y2) {
        x += dx;
        y += dy;
        undergrounds.push({x, y});
    }

    if (undergrounds.length > MAX_UNDERGROUND_LENGTH) {
        return [];
    }

    return undergrounds;
}
