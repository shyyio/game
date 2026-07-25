import {
    AnimatedTile,
    Sprite,
    Texture,
    TILE_SIZE,
    Direction,
    AbstractTileMeshDrawLayer,
} from "@/sdk/client.js";
import {chunkId, getOrCreate, removeFromGroup} from "@/sdk/common.js";
import {BeltBend, BELT_NORMAL, BELT_RAMP_DOWN, BELT_RAMP_UP, BELT_UNDERGROUND} from "../common/constants.js";
import {inferBeltParent} from "../common/geometry.js";

// Map-mode tile fill colors.
const MAP_TILE_COLOR = 0xf7df9e;
const MAP_RAMP_COLOR = 0xc8a16e;

// Every beltFrameBase result except the never-drawn buried underground.
const BELT_SEQUENCES = [
    "belt-straight",
    "belt-left",
    "belt-right",
    "belt-ramp-up",
    "belt-ramp-down",
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
    if (type === BELT_RAMP_UP) {
        return "belt-ramp-up";
    }
    if (type === BELT_RAMP_DOWN) {
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
        this.parentX = x;
        this.parentY = y;
        this.direction = direction;
        this.bend = bend;
        this.type = type;
        // Behind any real epoch, so the first tick derives this belt's bend.
        this.bendEpoch = -1;
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

export class BeltDrawLayer extends AbstractTileMeshDrawLayer {

    constructor() {
        super();
        /**
         * @type {Map<number, Belt>}
         */
        this._belts = new Map();
        // The belts each chunk holds.
        this._chunkBelts = new Map();
        // Bumped on structural cache changes; a belt with an older bendEpoch re-derives when next ticked.
        this._bendEpoch = 0;
    }

    get layerIndex() {
        return 10;
    }

    get meshSequences() {
        return BELT_SEQUENCES;
    }

    /**
     * A bend depends on neighbors of any mod, so any structural change flags every bend for a lazy re-derive.
     * @returns {void}
     */
    onCacheStructuralChange() {
        this._bendEpoch += 1;
    }

    /**
     * Draws a tile per belt into the chunk's pooled Graphics, one fill per color.
     * @param {number} chunk
     * @param {Graphics} graphics
     * @returns {void}
     */
    _drawChunkGeometry(chunk, graphics) {
        for (const color of [MAP_TILE_COLOR, MAP_RAMP_COLOR]) {
            let drew = false;
            for (const belt of this._beltsIn(chunk)) {
                const beltColor = belt.type === BELT_NORMAL ? MAP_TILE_COLOR : MAP_RAMP_COLOR;
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
     * @param {number} chunk
     * @returns {AnimatedTile[]}
     */
    _buildTiles(chunk) {
        const tiles = [];
        for (const belt of this._beltsIn(chunk)) {
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
     * @param {number} chunk
     * @returns {Iterable<Belt>}
     * @private
     */
    _beltsIn(chunk) {
        const belts = this._chunkBelts.get(chunk);
        return belts === undefined ? [] : belts;
    }

    /**
     * Renders a belt (buried undergrounds skipped); bend added straight, re-derived on the next structural change.
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
        const belt = new Belt(id, x, y, direction, BeltBend.STRAIGHT, type);
        this._belts.set(id, belt);

        const chunk = chunkId(x, y);
        getOrCreate(this._chunkBelts, chunk, () => new Set()).add(belt);
        this._memberAdded(chunk);
    }

    /**
     * Re-derives invalidated bends, marking the chunk for a mesh rebuild when any turned.
     * @param {number} chunk
     * @returns {void}
     * @private
     */
    _refreshBends(chunk) {
        for (const belt of this._beltsIn(chunk)) {
            if (belt.bendEpoch === this._bendEpoch) {
                continue;
            }
            belt.bendEpoch = this._bendEpoch;
            if (belt.type === BELT_NORMAL && this._applyBend(belt)) {
                this._dirtyChunks.add(chunk);
            }
        }
    }

    /**
     * Re-derives a normal belt's bend from its cached neighbors.
     * @param {Belt} belt
     * @returns {boolean} whether the bend changed
     * @private
     */
    _applyBend(belt) {
        const {parentX, parentY} = inferBeltParent(this.cache, belt.x, belt.y, belt.direction);
        const bend = Belt.getBend(belt.direction, belt.x, belt.y, parentX, parentY);
        if (bend === belt.bend) {
            return false;
        }
        belt.bend = bend;
        return true;
    }

    /**
     * @param {number} id
     */
    removeBelt(id) {
        const belt = this._belts.get(id);
        if (belt === undefined) {
            return;
        }

        const chunk = chunkId(belt.x, belt.y);
        this._belts.delete(id);

        removeFromGroup(this._chunkBelts, chunk, belt);
        this._memberRemoved(chunk, !this._chunkBelts.has(chunk));
    }

    /**
     * Re-derives stale bends, then advances every on-screen belt.
     * @param {number} frame animation frame, in [0, 8)
     * @param {number} deltaMS elapsed ms since the previous tick
     * @returns {void}
     */
    _updateSprites(frame, deltaMS) {
        for (const chunk of this._mounted) {
            this._refreshBends(chunk);
        }
        super._updateSprites(frame, deltaMS);
    }

    /**
     * Bends first: the mesh bakes them in, and a first-mount chunk has never derived them.
     * @param {number} chunk
     * @returns {void}
     */
    _prepareChunkSprites(chunk) {
        this._refreshBends(chunk);
        this._rebuildChunkSprites(chunk);
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
        // Behind any real epoch, so the first tick derives this belt's bend.
        this.bendEpoch = -1;

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
