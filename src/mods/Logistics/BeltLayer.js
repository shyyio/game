import {
    Graphics,
    Sprite,
    Texture,
    TILE_SIZE,
    Direction,
    AbstractDrawLayer,
    ChunkNode,
    currentAnimationFrame,
    sameChunks,
} from "@/sdk/client.js";
import {chunkId} from "@/sdk/common.js";
import {BeltBend, BeltType} from "./constants.js";
import {inferBeltParent} from "./geometry.js";

// Map-mode tile fill colors, keyed by belt type.
const MAP_TILE_COLOR = 0xf7df9e;
const MAP_RAMP_COLOR = 0xc8a16e;

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

export class BeltDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();

        this._belts = {};
        this._chunks = new Map();
        // The chunks whose roots are mounted, and those whose pooled geometry is stale.
        this._mounted = new Set();
        this._dirtyChunks = new Set();
        this._visibleChunks = new Set();
        this._mapMode = false;
        // Bumped on every structural cache change; a sprite whose bend was derived at an older
        // epoch re-derives when next ticked, so belts off-screen at the change still catch up.
        this._bendEpoch = 0;
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
     * Swaps the mounted children between full sprites and pooled map geometry.
     * @param {boolean} value
     */
    set mapMode(value) {
        if (value === this._mapMode) {
            return;
        }
        this._mapMode = value;
        for (const chunk of this._mounted) {
            this._applyMode(chunk);
        }
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
            for (const sprite of node.spriteList) {
                const beltColor = sprite.type === BeltType.NORMAL ? MAP_TILE_COLOR : MAP_RAMP_COLOR;
                if (beltColor !== color) {
                    continue;
                }
                node.graphics.rect(sprite.tileX * TILE_SIZE, sprite.tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                drew = true;
            }
            if (drew) {
                node.graphics.fill(color);
            }
        }
        return node.graphics;
    }

    /**
     * No-op: belt rendering is driven imperatively by LogisticsClientMod, not by events.
     * @param {AbstractEvent} event
     */
    onEvent(event) {}

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
        const frames = this._getFrames(BeltBend.STRAIGHT, type);
        const sprite = new BeltSprite(id, x, y, direction, BeltBend.STRAIGHT, type, frames);
        sprite.setAnimationFrame(currentAnimationFrame());
        this._belts[sprite.id] = sprite;

        const chunk = chunkId(x, y);
        this._node(chunk).sprites.addChild(sprite);
        this._dirtyChunks.add(chunk);

        if (this._visibleChunks.has(chunk)) {
            this._mountChunk(chunk);
        }
    }

    /**
     * Re-derives a belt's bend if a structural change landed since its last derivation.
     * @param {BeltSprite} sprite
     * @returns {void}
     * @private
     */
    _refreshBend(sprite) {
        if (sprite.bendEpoch === this._bendEpoch) {
            return;
        }
        sprite.bendEpoch = this._bendEpoch;
        if (sprite.type === BeltType.NORMAL) {
            this._applyBend(sprite);
        }
    }

    /**
     * Re-derives a normal belt's bend from its cached neighbors, re-rendering only on a change.
     * @param {BeltSprite} sprite
     * @private
     */
    _applyBend(sprite) {
        const {parentX, parentY} = inferBeltParent(this.cache, sprite.tileX, sprite.tileY, sprite.direction);
        const bend = Belt.getBend(sprite.direction, sprite.tileX, sprite.tileY, parentX, parentY);
        if (bend === sprite.bend) {
            return;
        }
        sprite.frames = this._getFrames(bend, sprite.type);
        sprite.update(sprite.tileX, sprite.tileY, sprite.direction, bend);
    }

    /**
     * @param {number} id
     */
    removeBelt(id) {
        const belt = this._belts[id];

        if (belt === undefined) {
            return;
        }

        const chunk = chunkId(belt.tileX, belt.tileY);
        // Scans only its own chunk's children, and detaches from its parent.
        belt.destroy();
        delete this._belts[id];
        this._dirtyChunks.add(chunk);

        const node = this._chunks.get(chunk);
        if (node !== undefined && node.isEmpty) {
            this._unmountChunk(chunk);
            node.destroy();
            this._chunks.delete(chunk);
            this._dirtyChunks.delete(chunk);
        }
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
        if (this.cache === null) {
            return;
        }
        this._reconcileViewport(visibleChunks);
        if (this._mapMode) {
            this._flushDirtyChunks();
            return;
        }
        for (const chunk of this._mounted) {
            for (const sprite of this._chunks.get(chunk).spriteList) {
                this._refreshBend(sprite);
                sprite.setAnimationFrame(frame);
            }
        }
    }

    /**
     * Mounts the chunks that panned into view and unmounts those that panned out.
     * @param {Set<number>} visible the chunks the viewport covers this frame
     * @returns {void}
     * @private
     */
    _reconcileViewport(visible) {
        if (sameChunks(visible, this._visibleChunks)) {
            return;
        }

        for (const chunk of this._visibleChunks) {
            if (!visible.has(chunk)) {
                this._unmountChunk(chunk);
            }
        }

        for (const chunk of visible) {
            if (!this._visibleChunks.has(chunk)) {
                this._mountChunk(chunk);
            }
        }
        this._visibleChunks = visible;
    }

    /**
     * Rebuilds the pooled geometry of every mounted chunk a belt change invalidated, and drops the
     * geometry of chunks left empty.
     * @returns {void}
     * @private
     */
    _flushDirtyChunks() {
        if (this._dirtyChunks.size === 0) {
            return;
        }
        for (const chunk of this._dirtyChunks) {
            if (this._mounted.has(chunk)) {
                this._buildChunkGeometry(chunk);
            }
        }
        this._dirtyChunks.clear();
    }

    /**
     * The chunk's node, created empty on first use.
     * @param {number} chunk
     * @returns {ChunkNode}
     * @private
     */
    _node(chunk) {
        let node = this._chunks.get(chunk);
        if (node === undefined) {
            node = new ChunkNode();
            this._chunks.set(chunk, node);
        }
        return node;
    }

    /**
     * @param {number} chunk
     * @returns {void}
     * @private
     */
    _mountChunk(chunk) {
        const node = this._chunks.get(chunk);
        if (node === undefined || this._mounted.has(chunk)) {
            return;
        }
        this._mounted.add(chunk);
        this._applyMode(chunk);
        this.addChild(node.root);
    }

    /**
     * @param {number} chunk
     * @returns {void}
     * @private
     */
    _unmountChunk(chunk) {
        if (!this._mounted.has(chunk)) {
            return;
        }
        this.removeChild(this._chunks.get(chunk).root);
        this._mounted.delete(chunk);
    }

    /**
     * Hangs the current mode's node under the chunk root, detaching the other one.
     * @param {number} chunk
     * @returns {void}
     * @private
     */
    _applyMode(chunk) {
        const node = this._chunks.get(chunk);

        if (this._mapMode) {
            node.showGraphics(this._buildChunkGeometry(chunk));
            return;
        }
        node.showSprites();
    }

    /**
     * The ordered frame textures for a belt of the given bend and type.
     * @param {BeltBend} bend
     * @param {BeltType} type
     * @returns {Texture[]|undefined}
     */
    _getFrames(bend, type) {
        return this.textureRegistry.getAnimation(beltFrameBase(bend, type));
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
