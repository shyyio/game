import {
    AnimatedTile,
    Sprite,
    Texture,
    TILE_SIZE,
    Direction,
    AbstractTileMeshDrawLayer,
    LaneGeometryEvent,
} from "@spup/sdk/client";
import {chunkKeyAt, getOrCreate, removeFromGroup} from "@spup/sdk";
import {
    BeltBend,
    BELT_NORMAL,
    BELT_TUNNEL_DOWN,
    BELT_TUNNEL_UP,
    BELT_UNDERGROUND,
    MAP_COLOR_BELT,
    MAP_COLOR_BELT_TUNNEL,
} from "../common/constants.js";

// Every beltFrameBase result except the never-drawn buried underground.
const BELT_SEQUENCES = [
    "belt-straight",
    "belt-left",
    "belt-right",
    "belt-tunnel-up",
    "belt-tunnel-down",
];

/**
 * The spritesheet base sequence for a belt's bend and type (frames under "<base>/0..7").
 * @param {BeltBend} bend
 * @param {BeltType} type
 * @returns {string}
 */
export function beltFrameBase(bend, type) {
    if (type === BELT_UNDERGROUND) {
        return "belt-underground";
    }
    if (type === BELT_TUNNEL_UP) {
        return "belt-tunnel-up";
    }
    if (type === BELT_TUNNEL_DOWN) {
        return "belt-tunnel-down";
    }
    if (bend === BeltBend.LEFT) {
        return "belt-left";
    }
    if (bend === BeltBend.RIGHT) {
        return "belt-right";
    }
    return "belt-straight";
}

/**
 * The bend a belt draws for the edge its lane feeds it over, in the belt's own frame: a feed
 * heading LEFT comes off the right flank.
 * @param {Direction} parentEdge
 * @returns {BeltBend}
 */
export function beltBendOf(parentEdge) {
    if (parentEdge === Direction.LEFT) {
        return BeltBend.RIGHT;
    }
    if (parentEdge === Direction.RIGHT) {
        return BeltBend.LEFT;
    }
    return BeltBend.STRAIGHT;
}

export class Belt {

    /**
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {BeltBend} bend
     * @param {BeltType} type
     */
    constructor(id, x, y, direction, bend, type) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.direction = direction;
        this.bend = bend;
        this.type = type;
    }

    static getBend(direction, x, y, parentX, parentY) {
        if (parentX === null) {
            return BeltBend.STRAIGHT;
        }

        if (direction === Direction.UP && parentX > x) {
            return BeltBend.RIGHT;
        } else if (direction === Direction.UP && parentX < x) {
            return BeltBend.LEFT;
        } else if (direction === Direction.DOWN && parentX > x) {
            return BeltBend.LEFT;
        } else if (direction === Direction.DOWN && parentX < x) {
            return BeltBend.RIGHT;
        } else if (direction === Direction.LEFT && parentY < y) {
            return BeltBend.RIGHT;
        } else if (direction === Direction.LEFT && parentY > y) {
            return BeltBend.LEFT;
        } else if (direction === Direction.RIGHT && parentY < y) {
            return BeltBend.LEFT;
        } else if (direction === Direction.RIGHT && parentY > y) {
            return BeltBend.RIGHT;
        }

        return BeltBend.STRAIGHT;
    }
}

/**
 * Draws the belts; a belt's bend is the edge the sim's lane feeds it over, taken from the lane
 * geometry feed.
 */
export class BeltDrawLayer extends AbstractTileMeshDrawLayer {

    constructor() {
        super();
        /**
         * @type {Map<number, Belt>}
         */
        this._belts = new Map();
        // The belts each chunk holds.
        this._chunkBelts = new Map();
        // Belt id -> the edge its lane feeds it over; geometry may land before the belt is cached.
        this._parentEdges = new Map();
    }

    get layerIndex() {
        return 10;
    }

    get meshSequences() {
        return BELT_SEQUENCES;
    }

    get eventClasses() {
        return [LaneGeometryEvent];
    }

    /**
     * Records each cell's parent edge and re-bends the belts already drawn.
     * @param {LaneGeometryEvent} event
     * @returns {void}
     */
    onEvent(event) {
        for (let i = 0; i < event.cellObjectRefs.length; i += 1) {
            const id = event.cellObjectRefs[i];
            const edge = event.cellParentEdges[i];
            this._parentEdges.set(id, edge);
            const belt = this._belts.get(id);
            if (belt === undefined || belt.bend === beltBendOf(edge)) {
                continue;
            }
            belt.bend = beltBendOf(edge);
            this._dirtyChunks.add(chunkKeyAt(belt.x, belt.y));
        }
    }

    /**
     * Draws a tile per belt into the chunk's pooled Graphics, one fill per color.
     * @param {number} chunkKey
     * @param {Graphics} graphics
     * @returns {void}
     */
    _drawChunkGeometry(chunkKey, graphics) {
        for (const color of [MAP_COLOR_BELT, MAP_COLOR_BELT_TUNNEL]) {
            let drew = false;
            for (const belt of this._beltsIn(chunkKey)) {
                const beltColor = belt.type === BELT_NORMAL ? MAP_COLOR_BELT : MAP_COLOR_BELT_TUNNEL;
                if (beltColor !== color) {
                    continue;
                }
                graphics.rect(belt.x * TILE_SIZE, belt.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                drew = true;
            }
            if (drew) {
                graphics.fill(color);
            }
        }
    }

    /**
     * The mesh tiles of a chunk's belts.
     * @param {number} chunkKey
     * @returns {AnimatedTile[]}
     */
    _buildTiles(chunkKey) {
        const tiles = [];
        for (const belt of this._beltsIn(chunkKey)) {
            tiles.push(new AnimatedTile(
                belt.x,
                belt.y,
                belt.direction,
                this._slotOf(beltFrameBase(belt.bend, belt.type)),
            ));
        }
        return tiles;
    }

    /**
     * The belts a chunk holds.
     * @param {number} chunkKey
     * @returns {Iterable<Belt>}
     * @private
     */
    _beltsIn(chunkKey) {
        const belts = this._chunkBelts.get(chunkKey);
        if (belts === undefined) {
            return [];
        }
        return belts;
    }

    /**
     * Renders a belt (buried undergrounds skipped), bent by the edge its lane already reported.
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {BeltType} type
     */
    addBelt(id, x, y, direction, type) {
        if (type === BELT_UNDERGROUND) {
            return;
        }
        const edge = this._parentEdges.get(id);
        const bend = edge === undefined ? BeltBend.STRAIGHT : beltBendOf(edge);
        const belt = new Belt(id, x, y, direction, bend, type);
        this._belts.set(id, belt);

        const chunkKey = chunkKeyAt(x, y);
        getOrCreate(this._chunkBelts, chunkKey, () => new Set()).add(belt);
        this._memberAdded(chunkKey);
    }

    /**
     * @param {number} id
     */
    removeBelt(id) {
        this._parentEdges.delete(id);
        const belt = this._belts.get(id);
        if (belt === undefined) {
            return;
        }

        const chunkKey = chunkKeyAt(belt.x, belt.y);
        this._belts.delete(id);

        removeFromGroup(this._chunkBelts, chunkKey, belt);
        this._memberRemoved(chunkKey, !this._chunkBelts.has(chunkKey));
    }
}

export class BeltSprite extends Sprite {

    /**
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {BeltBend} bend
     * @param {BeltType} type
     * @param {Texture[]|undefined} frames ordered animation frames
     */
    constructor(id, x, y, direction, bend, type, frames) {
        super(Texture.EMPTY);

        this.id = id;
        this.tileX = x;
        this.tileY = y;
        this.anchor = 0.5;
        this.angle = Direction.angle(direction);
        this.direction = direction;
        this.bend = bend;
        this.type = type;
        this.frames = frames;

        this.position.set(x * TILE_SIZE + 32, y * TILE_SIZE + 32);
    }

    /**
     * Renders this sprite as a placement-preview ghost in the given tint and alpha.
     * @param {number} tint
     * @param {number} [alpha]
     */
    setGhost(tint, alpha=1) {
        this.tint = tint;
        this.alpha = alpha;
    }

    /**
     * Shows a frame by index, wrapping modulo the sequence length.
     * @param {number} frame animation frame, in [0, 8)
     */
    setAnimationFrame(frame) {
        if (this.frames === undefined || this.frames.length === 0) {
            this.texture = Texture.EMPTY;
            return;
        }
        this.texture = this.frames[frame % this.frames.length];
    }

    update(x, y, direction, bend) {
        this.direction = direction;
        this.angle = Direction.angle(direction);
        this.bend = bend;
        this.tileX = x;
        this.tileY = y;
        this.x = x * TILE_SIZE + 32;
        this.y = y * TILE_SIZE + 32;
    }
}
