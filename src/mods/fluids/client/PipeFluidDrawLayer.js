import {
    AbstractChunkedDrawLayer,
    Graphics,
    TILE_SIZE,
    EMPTY,
    getOrCreate,
    removeFromGroup,
} from "@spup/sdk/client";
import {isPipeType} from "../common/objectTypes.js";
import {fluidColor, DRAW_LAYER_PIPE_FLUID} from "../common/constants.js";

// The fill rectangle's inset from the tile edge, in pixels.
const FILL_INSET = 12;

// Fill opacity over the pipe sprite.
const FILL_ALPHA = 0.9;

/**
 * One pipe tile's fluid-fill state and pooled Graphics.
 */
class PipeFillSprite {

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} chunkKey
     */
    constructor(tileX, tileY, chunkKey) {
        this.tileX = tileX;
        this.tileY = tileY;
        this.chunkKey = chunkKey;
        this.fluidType = EMPTY;
        this.fraction = 0;
        this.graphics = new Graphics();
    }
}

/**
 * Fluid-fill overlay per pipe tile, off the shared cache; the derived ObjectDrawLayer draws the
 * sprites, this layer only the fill the client mod fans out per network.
 */
export class PipeFluidDrawLayer extends AbstractChunkedDrawLayer {

    constructor() {
        super();
        /**
         * Pipe id -> its fill.
         * @type {Map<number, PipeFillSprite>}
         */
        this._fills = new Map();
        /**
         * For map-mode geometry.
         * @type {Map<number, Set<number>>}
         */
        this._fillsByChunk = new Map();
    }

    get layerIndex() {
        return DRAW_LAYER_PIPE_FLUID;
    }

    /**
     * Mirrors a set pipe entry into an empty fill graphic.
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheSet(entry) {
        if (!isPipeType(entry.data.type)) {
            return;
        }
        this.removePipe(entry.id);
        const fill = new PipeFillSprite(entry.tileX, entry.tileY, entry.chunkKey);
        this._fills.set(entry.id, fill);
        getOrCreate(this._fillsByChunk, fill.chunkKey, () => new Set()).add(fill);
        this._node(fill.chunkKey).sprites.addChild(fill.graphics);
        this._memberAdded(fill.chunkKey);
    }

    /**
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheRemove(entry) {
        if (isPipeType(entry.data.type)) {
            this.removePipe(entry.id);
        }
    }

    /**
     * @param {number} id
     * @returns {void}
     */
    removePipe(id) {
        const fill = this._fills.get(id);
        if (fill === undefined) {
            return;
        }
        fill.graphics.destroy();
        this._fills.delete(id);
        removeFromGroup(this._fillsByChunk, fill.chunkKey, fill);
        const node = this._chunks.get(fill.chunkKey);
        this._memberRemoved(fill.chunkKey, node === undefined || node.isEmpty);
    }

    /**
     * Sets one pipe tile's fill; fraction 0 clears it.
     * @param {number} id
     * @param {number} fluidType
     * @param {number} fraction - fill level in [0, 1]
     * @returns {void}
     */
    setFluid(id, fluidType, fraction) {
        const fill = this._fills.get(id);
        if (fill === undefined) {
            return;
        }
        fill.fluidType = fluidType;
        fill.fraction = fraction;
        this._drawFill(fill);
        this._dirtyChunks.add(fill.chunkKey);
    }

    /**
     * Redraws one fill's fill rectangle, bottom-up by fraction.
     * @private
     * @param {PipeFillSprite} fill
     * @returns {void}
     */
    _drawFill(fill) {
        const graphics = fill.graphics;
        graphics.clear();
        if (fill.fraction <= 0) {
            return;
        }
        const inner = TILE_SIZE - 2 * FILL_INSET;
        const height = Math.max(2, Math.round(inner * Math.min(fill.fraction, 1)));
        graphics.rect(
            fill.tileX * TILE_SIZE + FILL_INSET,
            fill.tileY * TILE_SIZE + FILL_INSET + inner - height,
            inner,
            height,
        );
        graphics.fill({color: fluidColor(fill.fluidType), alpha: FILL_ALPHA});
    }

    /**
     * Draws every filled pipe tile in the chunk into its pooled Graphics.
     * @param {number} chunkKey
     * @param {Graphics} graphics
     * @returns {void}
     */
    _drawChunkGeometry(chunkKey, graphics) {
        const fills = this._fillsByChunk.get(chunkKey);
        if (fills === undefined) {
            return;
        }
        for (const fill of fills) {
            if (fill.fraction <= 0) {
                continue;
            }
            graphics.rect(fill.tileX * TILE_SIZE, fill.tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            graphics.fill(fluidColor(fill.fluidType));
        }
    }
}
