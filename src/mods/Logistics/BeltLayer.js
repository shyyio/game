import {
    AnimatedTile,
    Sprite,
    Texture,
    TILE_SIZE,
    Direction,
    AbstractTileMeshDrawLayer,
} from "@/sdk/client.js";
import {chunkId, getOrCreate} from "@/sdk/common.js";
import {BeltBend, BeltType} from "./constants.js";
import {inferBeltParent} from "./geometry.js";

// Map-mode tile fill colors, keyed by belt type.
const MAP_TILE_COLOR = 0xf7df9e;
const MAP_RAMP_COLOR = 0xc8a16e;

// The sequences a drawn belt can animate through — every base {@link beltFrameBase} returns except
// the buried underground, which is never drawn.
const BELT_SEQUENCES = [
    "belt-straight",
    "belt-left",
    "belt-right",
    "belt-ramp-up",
    "belt-ramp-down",
];

/**
 * The spritesheet base sequence name for a belt of the given bend and type (frames live under "<base>/0..7").
 * @param {BeltBend} bend
 * @param {BeltType} type
 * @returns {string}
 */
export function beltFrameBase(bend, type) {
    if (type === BeltType.UNDERGROUND) {
        return "belt-underground";
    }
    if (type === BeltType.RAMP_UP) {
        return "belt-ramp-up";
    }
    if (type === BeltType.RAMP_DOWN) {
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
        // Bumped on every structural cache change; a belt whose bend was derived at an older
        // epoch re-derives when next ticked, so belts off-screen at the change still catch up.
        this._bendEpoch = 0;
    }

    get layerIndex() {
        return 10;
    }

    get meshSequences() {
        return BELT_SEQUENCES;
    }

    /**
     * A belt's bend depends on neighboring objects of any mod (belts, splitters, machines feeding
     * it from the side), so any structural change flags every bend for a lazy re-derive.
     * @returns {void}
     */
    onCacheStructuralChange() {
        this._bendEpoch += 1;
    }

    /**
     * Draws a tile per belt in the chunk into its pooled Graphics, one fill per belt color.
     * @param {number} chunk
     * @param {Graphics} graphics
     * @returns {void}
     */
    _drawChunkGeometry(chunk, graphics) {
        for (const color of [MAP_TILE_COLOR, MAP_RAMP_COLOR]) {
            let drew = false;
            for (const belt of this._beltsIn(chunk)) {
                const beltColor = belt.type === BeltType.NORMAL ? MAP_TILE_COLOR : MAP_RAMP_COLOR;
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
     * The mesh tiles of a chunk's belts, each carrying its tile, facing and sequence, so the
     * animation itself never touches them again.
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
     * The belts a chunk holds, empty when it holds none.
     * @param {number} chunk
     * @returns {Iterable<Belt>}
     * @private
     */
    _beltsIn(chunk) {
        const belts = this._chunkBelts.get(chunk);
        return belts === undefined ? [] : belts;
    }

    /**
     * Renders a newly-placed or chunk-synced belt (undergrounds are buried and skipped). The
     * bend is added straight and re-derived from neighbors on the next structural cache change.
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {BeltType} type
     */
    addBelt(id, x, y, direction, type) {
        if (type === BeltType.UNDERGROUND) {
            return;
        }
        const belt = new Belt(id, x, y, direction, BeltBend.STRAIGHT, type);
        this._belts.set(id, belt);

        const chunk = chunkId(x, y);
        getOrCreate(this._chunkBelts, chunk, () => new Set()).add(belt);
        this._memberAdded(chunk);
    }

    /**
     * Re-derives the bends of a chunk's belts that a structural change invalidated, marking the
     * chunk for a mesh rebuild when any of them turned.
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
            if (belt.type === BeltType.NORMAL && this._applyBend(belt)) {
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

        const belts = this._chunkBelts.get(chunk);
        belts.delete(belt);
        if (belts.size === 0) {
            this._chunkBelts.delete(chunk);
        }
        this._memberRemoved(chunk, belts.size === 0);
    }

    /**
     * Re-derives stale bends, then advances every on-screen belt with the shared uniform write.
     * @param {number} frame animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @returns {void}
     */
    _updateSprites(frame, deltaMS) {
        for (const chunk of this._mounted) {
            this._refreshBends(chunk);
        }
        super._updateSprites(frame, deltaMS);
    }

    /**
     * Bends first: the mesh bakes them in, and a chunk mounting for the first time has never
     * derived them.
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
     * @param {Texture[]|undefined} frames ordered animation frames for this bend/type
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
     * Shows the given frame by array index, wrapping modulo the sequence length so single-frame sprites stay put.
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
