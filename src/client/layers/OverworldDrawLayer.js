import {Graphics} from "pixi.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {TILE_SIZE, ViewMode} from "@/client/constants.js";
import {CHUNK_SIZE, REGION_SIZE} from "@/common/constants.js";
import {chunkOrigin, chunkPosition} from "@/common/util.js";
import {MAP_TILE_COLOR} from "@/client/Theme.js";

const CHUNK_PX = CHUNK_SIZE * TILE_SIZE;
const REGION_HALF_PX = (REGION_SIZE / 2) * CHUNK_PX;

/**
 * Renders the baked overworld: a region-wide backdrop matching the map-mode grid look, plus one
 * Graphics of colored tile runs per cached chunk. Not chunk-mounted — overworld mode has no chunk
 * subscriptions; content comes straight from the overworld state. Claim fills and labels come
 * from the claims layer above.
 */
export class OverworldDrawLayer extends AbstractDrawLayer {

    /**
     * @param {ModRegistry} modRegistry
     * @param {ClientCache} state
     */
    constructor(modRegistry, state) {
        super();
        this.modRegistry = modRegistry;
        // Chunk ordinal -> its runs Graphics.
        this._graphics = new Map();
        this._background = null;
        this._lastCullKey = null;
        this.visible = false;
        state.subscribe("overworld.byChunk", (chunk, entry) => {
            if (entry === undefined || entry.runStarts.length === 0) {
                this._dropChunk(chunk);
            } else {
                this._drawChunk(entry);
            }
        });
    }

    get layerIndex() {
        return 40;
    }

    /**
     * Shown only in overworld mode; the backdrop builds lazily on first show.
     * @param {ViewMode} mode
     * @returns {void}
     */
    setViewMode(mode) {
        this.visible = mode === ViewMode.OVERWORLD;
        if (this.visible && this._background === null) {
            this._background = this._buildBackground();
            this.addChildAt(this._background, 0);
        }
        if (this.visible) {
            this._lastCullKey = null;
        }
    }

    /**
     * Culls chunk Graphics against the viewport when its chunk rect changes.
     * @param {number} frame
     * @param {number} deltaMS
     * @param {Set<number>} visibleChunks
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        if (!this.visible) {
            return;
        }
        // One chunk of margin, mirroring the mounted layers' lead-in.
        const left = Math.floor(this.viewport.left / CHUNK_PX) - 1;
        const top = Math.floor(this.viewport.top / CHUNK_PX) - 1;
        const right = Math.floor(this.viewport.right / CHUNK_PX) + 1;
        const bottom = Math.floor(this.viewport.bottom / CHUNK_PX) + 1;
        const cullKey = `${left};${top};${right};${bottom}`;
        if (cullKey === this._lastCullKey) {
            return;
        }
        this._lastCullKey = cullKey;
        for (const [chunk, graphics] of this._graphics) {
            const position = chunkPosition(chunk);
            graphics.visible = position.x >= left && position.x <= right
                && position.y >= top && position.y <= bottom;
        }
    }

    /**
     * @private
     * @param {number} chunk
     * @returns {void}
     */
    _dropChunk(chunk) {
        const graphics = this._graphics.get(chunk);
        if (graphics === undefined) {
            return;
        }
        this.removeChild(graphics);
        graphics.destroy();
        this._graphics.delete(chunk);
    }

    /**
     * Draws one chunk's runs, one rect per run, batched into one fill per color.
     * @private
     * @param {OverworldChunkState} entry
     * @returns {void}
     */
    _drawChunk(entry) {
        let graphics = this._graphics.get(entry.chunk);
        if (graphics === undefined) {
            graphics = new Graphics();
            const origin = chunkOrigin(entry.chunk);
            graphics.position.set(origin.x * TILE_SIZE, origin.y * TILE_SIZE);
            // Visible until the next cull pass re-evaluates it.
            this._lastCullKey = null;
            this._graphics.set(entry.chunk, graphics);
            this.addChild(graphics);
        } else {
            graphics.clear();
        }
        const runsByColor = new Map();
        for (let run = 0; run < entry.runStarts.length; run += 1) {
            const type = this.modRegistry.typeById(entry.runTypeIds[run]);
            let color;
            if (type.mapColor !== null) {
                color = type.mapColor;
            } else {
                color = MAP_TILE_COLOR;
            }
            let runs = runsByColor.get(color);
            if (runs === undefined) {
                runs = [];
                runsByColor.set(color, runs);
            }
            runs.push(run);
        }
        for (const [color, runs] of runsByColor) {
            for (const run of runs) {
                const start = entry.runStarts[run];
                const tileX = start % CHUNK_SIZE;
                const tileY = Math.floor(start / CHUNK_SIZE);
                graphics.rect(tileX * TILE_SIZE, tileY * TILE_SIZE, entry.runLengths[run] * TILE_SIZE, TILE_SIZE);
            }
            graphics.fill(color);
        }
    }

    /**
     * The region-wide backdrop: white fill plus chunk outlines, matching the map-mode grid look
     * at chunk (not tile) granularity.
     * @private
     * @returns {Graphics}
     */
    _buildBackground() {
        const graphics = new Graphics()
            .rect(-REGION_HALF_PX, -REGION_HALF_PX, REGION_SIZE * CHUNK_PX, REGION_SIZE * CHUNK_PX)
            .fill("white");
        for (let i = 0; i <= REGION_SIZE; i += 1) {
            const offset = -REGION_HALF_PX + i * CHUNK_PX;
            graphics
                .moveTo(offset, -REGION_HALF_PX)
                .lineTo(offset, REGION_HALF_PX)
                .moveTo(-REGION_HALF_PX, offset)
                .lineTo(REGION_HALF_PX, offset);
        }
        graphics.stroke({color: 0x000000, pixelLine: true, alpha: 0.2});
        return graphics;
    }
}
