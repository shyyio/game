import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {Container, Graphics, GraphicsContext} from "pixi.js";
import {chunkPosition} from "@/common/util.js";
import {TILE_SIZE} from "@/client/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {ChunkSubscribeEvent, ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";

export class GridDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        /**
         * @type {Map<number, GridChunk>}
         */
        this._chunks = new Map();
        this._isMapMode = false;
        this._isEnabled = false;
        // Every chunk's grid is the same geometry: built once, shared by all chunk Graphics.
        this._majorContext = GridDrawLayer._buildMajorContext();
        this._minorContext = GridDrawLayer._buildMinorContext();
    }

    get layerIndex() {
        return 0;
    }

    /**
     * @param {number} chunkKey
     */
    addChunk(chunkKey) {
        if (this._chunks.has(chunkKey)) {
            return;
        }

        const {x, y} = chunkPosition(chunkKey);
        const tileX = x * CHUNK_SIZE;
        const tileY = y * CHUNK_SIZE;
        const grid = new GridChunk(this._majorContext, this._minorContext);
        grid.minor.visible = this._isMinorVisible();
        grid.position.set(tileX * TILE_SIZE, tileY * TILE_SIZE);
        grid.zIndex = tileX + tileY;
        this._chunks.set(chunkKey, grid);
        this.addChild(grid);
    }

    /**
     * @param {number} chunkKey
     */
    removeChunk(chunkKey) {
        const grid = this._chunks.get(chunkKey);
        if (grid === undefined) {
            return;
        }

        this.removeChild(grid);
        // The Graphics views die with the container; the shared contexts live on.
        grid.destroy({children: true});
        this._chunks.delete(chunkKey);
    }

    set isMapMode(value) {
        this._isMapMode = value;
        this._applyMinorVisibility();
    }

    /**
     * Shows or hides the tile lines; the chunk outlines stay whatever this is.
     * @param {boolean} enabled
     * @returns {void}
     */
    setEnabled(enabled) {
        this._isEnabled = enabled;
        this._applyMinorVisibility();
    }

    /**
     * @private
     * @returns {boolean}
     */
    _isMinorVisible() {
        return this._isEnabled && !this._isMapMode;
    }

    /**
     * @private
     * @returns {void}
     */
    _applyMinorVisibility() {
        const isVisible = this._isMinorVisible();
        for (const grid of this._chunks.values()) {
            grid.minor.visible = isVisible;
        }
    }

    get eventClasses() {
        return [ChunkSubscribeEvent, ChunkUnsubscribeEvent];
    }

    onEvent(event) {
        if (event instanceof ChunkSubscribeEvent) {
            this.addChunk(event.chunkKey);
        } else if (event instanceof ChunkUnsubscribeEvent) {
            this.removeChunk(event.chunkKey);
        }
    }

    /**
     * The chunk outline, origin-relative; the ground under it is the terrain layer's.
     * @private
     * @returns {GraphicsContext}
     */
    static _buildMajorContext() {
        return new GraphicsContext()
            .rect(0, 0, TILE_SIZE * CHUNK_SIZE, TILE_SIZE * CHUNK_SIZE)
            .stroke({color: 0xffffff, pixelLine: true, alpha: 0.7});
    }

    /**
     * The tile lines within a chunk, origin-relative.
     * @private
     * @returns {GraphicsContext}
     */
    static _buildMinorContext() {
        const context = new GraphicsContext();
        for (let i = 0; i < CHUNK_SIZE; i++) {
            context
                .moveTo(i * TILE_SIZE, 0)
                .lineTo(i * TILE_SIZE, CHUNK_SIZE * TILE_SIZE);
            context
                .moveTo(0, i * TILE_SIZE)
                .lineTo(CHUNK_SIZE * TILE_SIZE, i * TILE_SIZE);
        }
        context.stroke({color: 0xffffff, pixelLine: true, alpha: 0.3});
        return context;
    }
}

/**
 * One chunk's grid: the chunk outline plus its tile lines, which the detailed overlay shows.
 */
class GridChunk extends Container {

    /**
     * @param {GraphicsContext} majorContext
     * @param {GraphicsContext} minorContext
     */
    constructor(majorContext, minorContext) {
        super();
        this.addChild(new Graphics(majorContext));
        this.minor = this.addChild(new Graphics(minorContext));
    }
}
