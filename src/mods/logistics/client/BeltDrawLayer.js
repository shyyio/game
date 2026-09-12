import {
    AnimatedTile,
    Sprite,
    Texture,
    TILE_SIZE,
    Direction,
    AbstractTileMeshDrawLayer,
    LaneCreatedEvent,
} from "@spup/sdk/client";
import {
    chunkKeyAt,
    getOrCreate,
    removeFromGroup,
} from "@spup/sdk";
import {
    BeltBend,
    BELT_TUNNEL_DOWN,
    BELT_TUNNEL_UP,
    BELT_UNDERGROUND,
    getBeltKindEntryByKind,
    isBeltRamp,
    MAP_COLOR_BELT,
    MAP_COLOR_BELT_TUNNEL,
    MAP_COLOR_BELT_RAMP,
    MAP_COLOR_BELT_ELEVATED_1,
} from "../common/constants.js";
import {getBeltTypeByKind} from "../common/objectTypes.js";

// Every beltFrameBase result except the never-drawn buried underground.
const BELT_SEQUENCES = [
    "belt-straight",
    "belt-left",
    "belt-right",
    "belt-tunnel-up",
    "belt-tunnel-down",
    "belt-ramp-up",
    "belt-ramp-down",
];

// Map-mode fills a chunk's belts draw, one pass per color.
const BELT_MAP_COLORS = [
    MAP_COLOR_BELT,
    MAP_COLOR_BELT_TUNNEL,
    MAP_COLOR_BELT_RAMP,
    MAP_COLOR_BELT_ELEVATED_1,
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
    if (isBeltRamp(type)) {
        const ramp = getBeltKindEntryByKind(type);
        if (ramp.outLevel > ramp.inLevel) {
            return "belt-ramp-up";
        }
        return "belt-ramp-down";
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
 * The bend a belt draws for the edge its parent hands it over, in the belt's own frame: a parent
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

export class BeltEntry {

    /**
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {BeltBend} bend
     * @param {BeltType} type
     * @param {number} mapColor
     */
    constructor(id, x, y, direction, bend, type, mapColor) {
        this.mapColor = mapColor;
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

// Pixels an elevated cell's sprite sits above its tile, so it reads as standing over the ground.
export const ELEVATED_DRAW_HEIGHT = 24;

/**
 * Draws the belts of one level; a belt's bend is the edge its parent hands it over, taken from the
 * lane geometry feed.
 */
export class BeltDrawLayer extends AbstractTileMeshDrawLayer {

    /**
     * @param {number} layerIndex
     * @param {number} drawHeight - pixels the level's sprites sit above their tiles
     * @param {Map<number, Direction>} parentEdges - belt id -> the edge its parent hands it over,
     *     shared by every level's layer; geometry may land before the belt is cached
     */
    constructor(layerIndex, drawHeight, parentEdges) {
        super();
        this._layerIndex = layerIndex;
        this._drawHeight = drawHeight;
        /**
         * @type {Map<number, BeltEntry>}
         */
        this._belts = new Map();
        // The belts each chunk holds.
        this._chunkBelts = new Map();
        this._parentEdges = parentEdges;
    }

    get layerIndex() {
        return this._layerIndex;
    }

    get meshSequences() {
        return BELT_SEQUENCES;
    }

    /**
     * Lifts the chunk's sprites off their tiles; the map-mode geometry stays on the grid.
     * @param {ChunkNode} node
     * @param {number} chunkKey
     * @returns {void}
     */
    _initChunkNode(node, chunkKey) {
        super._initChunkNode(node, chunkKey);
        node.sprites.y = -this._drawHeight;
    }

    get eventClasses() {
        return [LaneCreatedEvent];
    }

    /**
     * Records each cell's parent edge and re-bends the belts already drawn.
     * @param {LaneCreatedEvent} event
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
        for (const color of BELT_MAP_COLORS) {
            let drew = false;
            for (const belt of this._getBeltsByChunkKey(chunkKey)) {
                if (belt.mapColor !== color) {
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
        for (const belt of this._getBeltsByChunkKey(chunkKey)) {
            tiles.push(new AnimatedTile(
                belt.x,
                belt.y,
                belt.direction,
                this._getSlotByName(beltFrameBase(belt.bend, belt.type)),
            ));
        }
        return tiles;
    }

    /**
     * The belts a chunk holds.
     * @param {number} chunkKey
     * @returns {Iterable<BeltEntry>}
     * @private
     */
    _getBeltsByChunkKey(chunkKey) {
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
        let bend;
        if (edge === undefined) {
            bend = BeltBend.STRAIGHT;
        } else {
            bend = beltBendOf(edge);
        }
        const belt = new BeltEntry(id, x, y, direction, bend, type, getBeltTypeByKind(type).mapColor);
        this._belts.set(id, belt);

        const chunkKey = chunkKeyAt(x, y);
        getOrCreate(this._chunkBelts, chunkKey, () => new Set()).add(belt);
        this._memberAdded(chunkKey);
    }

    /**
     * @param {number} id
     */
    removeBelt(id) {
        const belt = this._belts.get(id);
        if (belt === undefined) {
            return;
        }
        this._parentEdges.delete(id);

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

    draw(x, y, direction, bend) {
        this.direction = direction;
        this.angle = Direction.angle(direction);
        this.bend = bend;
        this.tileX = x;
        this.tileY = y;
        this.x = x * TILE_SIZE + 32;
        this.y = y * TILE_SIZE + 32;
    }
}
