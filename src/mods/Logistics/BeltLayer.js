import {
    AnimatedTile,
    AnimatedTileMesh,
    AnimatedTileShader,
    FrameTable,
    Graphics,
    Sprite,
    Texture,
    TILE_SIZE,
    Direction,
    AbstractChunkedDrawLayer,
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

export class BeltDrawLayer extends AbstractChunkedDrawLayer {

    constructor() {
        super();
        this._belts = {};
        // The belts each chunk holds, and the mesh drawing them.
        this._chunkBelts = new Map();
        this._meshes = new Map();
        // Bumped on every structural cache change; a belt whose bend was derived at an older
        // epoch re-derives when next ticked, so belts off-screen at the change still catch up.
        this._bendEpoch = 0;
        // Built on first use, once the texture registry is injected.
        this._frameTable = null;
        this._shader = null;
    }

    /**
     * The frame table and the shader every chunk mesh draws with, built on first use.
     * @returns {AnimatedTileShader}
     * @private
     */
    _beltShader() {
        if (this._shader === null) {
            if (this.textureRegistry === null) {
                throw new Error("BeltDrawLayer needs a texture registry before it draws");
            }
            this._frameTable = new FrameTable(this.textureRegistry, BELT_SEQUENCES);
            this._shader = new AnimatedTileShader(this._frameTable);
        }
        return this._shader;
    }

    get layerIndex() {
        return 10;
    }

    /**
     * Injected by Client.init; subscribing to structural cache changes flags bends for a
     * one-pass rebuild on the next tick, since a belt's bend depends on neighboring objects
     * of any mod (belts, splitters, machines feeding it from the side).
     * @param {ClientCache|null} value
     */
    set cache(value) {
        this._cache = value;
        if (value !== null) {
            value.onStructuralChange(() => {
                this._bendEpoch += 1;
            });
        }
    }

    /**
     * @returns {ClientCache|null}
     */
    get cache() {
        return this._cache;
    }

    /**
     * Redraws one chunk's map-mode geometry: a tile per belt in the chunk, pooled into the chunk's
     * single Graphics with one fill per belt color.
     * @param {number} chunk
     * @returns {Graphics}
     * @private
     */
    _buildChunkGeometry(chunk) {
        this._dirtyChunks.delete(chunk);

        const node = this._chunks.get(chunk);
        if (node.graphics === null) {
            node.graphics = new Graphics();
        } else {
            node.graphics.clear();
        }

        for (const color of [MAP_TILE_COLOR, MAP_RAMP_COLOR]) {
            let drew = false;
            for (const belt of this._beltsIn(chunk)) {
                const beltColor = belt.type === BeltType.NORMAL ? MAP_TILE_COLOR : MAP_RAMP_COLOR;
                if (beltColor !== color) {
                    continue;
                }
                node.graphics.rect(belt.x * TILE_SIZE, belt.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                drew = true;
            }
            if (drew) {
                node.graphics.fill(color);
            }
        }
        return node.graphics;
    }

    /**
     * Rebuilds one chunk's mesh from the belts it holds. The quads carry each belt's tile, facing and
     * sequence, so the animation itself never touches them again.
     * @param {number} chunk
     * @returns {void}
     * @private
     */
    _buildChunkMesh(chunk) {
        this._dirtyChunks.delete(chunk);

        const tiles = [];
        for (const belt of this._beltsIn(chunk)) {
            tiles.push(new AnimatedTile(
                belt.x,
                belt.y,
                belt.direction,
                this._frameTable.slotOf(beltFrameBase(belt.bend, belt.type)),
            ));
        }
        this._meshes.get(chunk).setTiles(tiles);
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
        this._belts[id] = belt;

        const chunk = chunkId(x, y);
        this._node(chunk);
        getOrCreate(this._chunkBelts, chunk, () => new Set()).add(belt);
        this._dirtyChunks.add(chunk);

        if (this._visibleChunks.has(chunk)) {
            this._mountChunk(chunk);
        }
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
        const belt = this._belts[id];

        if (belt === undefined) {
            return;
        }

        const chunk = chunkId(belt.x, belt.y);
        delete this._belts[id];
        this._dirtyChunks.add(chunk);

        const belts = this._chunkBelts.get(chunk);
        belts.delete(belt);
        if (belts.size > 0) {
            return;
        }
        this._chunkBelts.delete(chunk);
        this._dropChunk(chunk);
    }

    /**
     * @param {number} chunk
     * @returns {void}
     */
    _onChunkDropped(chunk) {
        this._meshes.delete(chunk);
    }

    /**
     * Reconciles mounted children against the viewport and pending belt changes, then re-derives
     * stale bends and advances every on-screen belt to the shared animation frame (map mode draws
     * no sprites).
     * @param {number} frame animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @param {Set<number>} visibleChunks the chunks the viewport covers this frame
     */
    tick(frame, deltaMS, visibleChunks) {
        this._reconcileViewport(visibleChunks);
        if (this._mapMode) {
            this._flushDirtyChunks();
            return;
        }
        for (const chunk of this._mounted) {
            this._refreshBends(chunk);
        }
        this._flushDirtyChunks();
        if (this._shader !== null) {
            // One write for every belt on screen: the meshes hold the animation frame as a uniform.
            this._shader.frame = frame;
        }
    }

    /**
     * Hangs the chunk's animated mesh under its fresh node.
     * @param {ChunkNode} node
     * @param {number} chunk
     * @returns {void}
     */
    _initChunkNode(node, chunk) {
        const mesh = new AnimatedTileMesh(this._beltShader());
        node.sprites.addChild(mesh);
        this._meshes.set(chunk, mesh);
    }

    /**
     * @param {number} chunk
     * @returns {void}
     */
    _rebuildChunk(chunk) {
        if (this._mapMode) {
            this._buildChunkGeometry(chunk);
        } else {
            this._buildChunkMesh(chunk);
        }
    }

    /**
     * Bends first: the mesh bakes them in, and a chunk mounting for the first time has never
     * derived them.
     * @param {number} chunk
     * @returns {void}
     */
    _prepareChunkSprites(chunk) {
        this._refreshBends(chunk);
        this._buildChunkMesh(chunk);
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
