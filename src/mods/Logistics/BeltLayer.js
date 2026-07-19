import {
    Graphics,
    Sprite,
    Texture,
    TILE_SIZE,
    Direction,
    AbstractDrawLayer,
    currentAnimationFrame,
    sameChunks,
    viewportChunks,
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
        // Belt ids per chunk, and the ids whose sprites are mounted (sprite mode).
        this._idsByChunk = new Map();
        this._mounted = new Set();
        // The pooled map-mode geometry per chunk, and the chunks whose geometry is mounted.
        this._mapChunks = new Map();
        this._mountedChunks = new Set();
        // Chunks whose pooled geometry no longer matches their belts.
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
        this._unmountAll();
        this._mapMode = value;
        for (const chunk of this._visibleChunks) {
            this._mountChunk(chunk);
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

        let graphics = this._mapChunks.get(chunk);
        if (graphics === undefined) {
            graphics = new Graphics();
            this._mapChunks.set(chunk, graphics);
        } else {
            graphics.clear();
        }

        for (const color of [MAP_TILE_COLOR, MAP_RAMP_COLOR]) {
            let drew = false;
            for (const id of this._chunkIds(chunk)) {
                const sprite = this._belts[id];
                const beltColor = sprite.type === BeltType.NORMAL ? MAP_TILE_COLOR : MAP_RAMP_COLOR;
                if (beltColor !== color) {
                    continue;
                }
                graphics.rect(sprite.tileX * TILE_SIZE, sprite.tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                drew = true;
            }
            if (drew) {
                graphics.fill(color);
            }
        }
        return graphics;
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
        const ids = this._idsByChunk.get(chunk);
        if (ids === undefined) {
            this._idsByChunk.set(chunk, new Set([sprite.id]));
        } else {
            ids.add(sprite.id);
        }
        this._dirtyChunks.add(chunk);

        if (this._mapMode || !this._visibleChunks.has(chunk)) {
            return;
        }
        this._mountSprite(sprite.id);
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

        this._unmountSprite(id);

        const chunk = chunkId(belt.tileX, belt.tileY);
        const ids = this._idsByChunk.get(chunk);
        if (ids !== undefined) {
            ids.delete(id);
            if (ids.size === 0) {
                this._idsByChunk.delete(chunk);
            }
        }
        this._dirtyChunks.add(chunk);

        belt.destroy();
        delete this._belts[id];
    }

    /**
     * Reconciles mounted children against the viewport and pending belt changes, then re-derives
     * stale bends and advances every on-screen belt to the shared animation frame (map mode draws
     * no sprites).
     * @param {number} frame animation frame, in [0, 8)
     */
    tick(frame) {
        if (this.cache === null) {
            return;
        }
        this._reconcileViewport();
        if (this._mapMode) {
            this._flushDirtyChunks();
            return;
        }
        for (const id of this._mounted) {
            const sprite = this._belts[id];
            this._refreshBend(sprite);
            sprite.setAnimationFrame(frame);
        }
    }

    /**
     * Mounts the chunks that panned into view and unmounts those that panned out.
     * @returns {void}
     * @private
     */
    _reconcileViewport() {
        const visible = viewportChunks(this.viewport);
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
            if (!this._idsByChunk.has(chunk)) {
                this._unmountChunk(chunk);
                const graphics = this._mapChunks.get(chunk);
                if (graphics !== undefined) {
                    graphics.destroy();
                    this._mapChunks.delete(chunk);
                }
            } else if (this._mountedChunks.has(chunk)) {
                this._buildChunkGeometry(chunk);
            } else if (this._visibleChunks.has(chunk)) {
                // Its first belt: the chunk had nothing to pool when it scrolled in.
                this._mountChunk(chunk);
            }
        }
        this._dirtyChunks.clear();
    }

    /**
     * Adds one chunk's children for the current mode.
     * @param {number} chunk
     * @returns {void}
     * @private
     */
    _mountChunk(chunk) {
        if (!this._mapMode) {
            for (const id of this._chunkIds(chunk)) {
                this._mountSprite(id);
            }
            return;
        }

        if (this._mountedChunks.has(chunk) || !this._idsByChunk.has(chunk)) {
            return;
        }
        this.addChild(this._buildChunkGeometry(chunk));
        this._mountedChunks.add(chunk);
    }

    /**
     * Removes one chunk's children of either mode, keeping them for a later remount.
     * @param {number} chunk
     * @returns {void}
     * @private
     */
    _unmountChunk(chunk) {
        for (const id of this._chunkIds(chunk)) {
            this._unmountSprite(id);
        }

        if (!this._mountedChunks.has(chunk)) {
            return;
        }
        this.removeChild(this._mapChunks.get(chunk));
        this._mountedChunks.delete(chunk);
    }

    /**
     * @returns {void}
     * @private
     */
    _unmountAll() {
        for (const id of this._mounted) {
            this.removeChild(this._belts[id]);
        }
        this._mounted.clear();

        for (const chunk of this._mountedChunks) {
            this.removeChild(this._mapChunks.get(chunk));
        }
        this._mountedChunks.clear();
    }

    /**
     * @param {number} id
     * @returns {void}
     * @private
     */
    _mountSprite(id) {
        if (this._mounted.has(id)) {
            return;
        }
        this.addChild(this._belts[id]);
        this._mounted.add(id);
    }

    /**
     * @param {number} id
     * @returns {void}
     * @private
     */
    _unmountSprite(id) {
        if (!this._mounted.has(id)) {
            return;
        }
        this.removeChild(this._belts[id]);
        this._mounted.delete(id);
    }

    /**
     * @param {number} chunk
     * @returns {Set<number>} the belt ids in `chunk`
     * @private
     */
    _chunkIds(chunk) {
        const ids = this._idsByChunk.get(chunk);
        return ids === undefined ? new Set() : ids;
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
