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
class PipeFill {

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} chunk
     */
    constructor(tileX, tileY, chunk) {
        this.tileX = tileX;
        this.tileY = tileY;
        this.chunk = chunk;
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
         * Pipe id -> its fill record.
         * @type {Map<number, PipeFill>}
         */
        this._fills = new Map();
        // Chunk -> the fill records in it, for map-mode geometry.
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
        const record = new PipeFill(entry.tileX, entry.tileY, entry.chunk);
        this._fills.set(entry.id, record);
        getOrCreate(this._fillsByChunk, record.chunk, () => new Set()).add(record);
        this._node(record.chunk).sprites.addChild(record.graphics);
        this._memberAdded(record.chunk);
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
        const record = this._fills.get(id);
        if (record === undefined) {
            return;
        }
        record.graphics.destroy();
        this._fills.delete(id);
        removeFromGroup(this._fillsByChunk, record.chunk, record);
        const node = this._chunks.get(record.chunk);
        this._memberRemoved(record.chunk, node === undefined || node.isEmpty);
    }

    /**
     * Sets one pipe tile's fill; fraction 0 clears it.
     * @param {number} id
     * @param {number} fluidType
     * @param {number} fraction - fill level in [0, 1]
     * @returns {void}
     */
    setFluid(id, fluidType, fraction) {
        const record = this._fills.get(id);
        if (record === undefined) {
            return;
        }
        record.fluidType = fluidType;
        record.fraction = fraction;
        this._redraw(record);
        this._dirtyChunks.add(record.chunk);
    }

    /**
     * Redraws one record's fill rectangle, bottom-up by fraction.
     * @private
     * @param {PipeFill} record
     * @returns {void}
     */
    _redraw(record) {
        const graphics = record.graphics;
        graphics.clear();
        if (record.fraction <= 0) {
            return;
        }
        const inner = TILE_SIZE - 2 * FILL_INSET;
        const height = Math.max(2, Math.round(inner * Math.min(record.fraction, 1)));
        graphics.rect(
            record.tileX * TILE_SIZE + FILL_INSET,
            record.tileY * TILE_SIZE + FILL_INSET + inner - height,
            inner,
            height,
        );
        graphics.fill({color: fluidColor(record.fluidType), alpha: FILL_ALPHA});
    }

    /**
     * Draws every filled pipe tile in the chunk into its pooled Graphics.
     * @param {number} chunk
     * @param {Graphics} graphics
     * @returns {void}
     */
    _drawChunkGeometry(chunk, graphics) {
        const records = this._fillsByChunk.get(chunk);
        if (records === undefined) {
            return;
        }
        for (const record of records) {
            if (record.fraction <= 0) {
                continue;
            }
            graphics.rect(record.tileX * TILE_SIZE, record.tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            graphics.fill(fluidColor(record.fluidType));
        }
    }
}
