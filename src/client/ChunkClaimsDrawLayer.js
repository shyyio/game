import {Graphics} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {TILE_SIZE, ViewMode} from "@/client/constants.js";
import {CHUNK_SIZE, PLAYER_ID_NONE} from "@/common/constants.js";
import {chunkOrigin, getOrCreate} from "@/common/util.js";
import {claimColor, OWN_CLAIM_COLOR, OWN_CLAIM_FILL_ALPHA, CLAIM_BORDER_ALPHA} from "@/client/Theme.js";

const CHUNK_PX = CHUNK_SIZE * TILE_SIZE;

// World-space border widths (one tile reads as a clear frame at map zoom).
const BORDER_WIDTH = TILE_SIZE;
const OWN_BORDER_WIDTH = TILE_SIZE * 1.5;

/**
 * Colored ownership borders around claimed chunks, shown in map and overworld mode. Not
 * chunk-mounted: claims are few and global, drawn straight from the ChunkClaimsCache.
 */
export class ChunkClaimsDrawLayer extends AbstractDrawLayer {

    /**
     * @param {ChunkClaimsCache} claimsCache
     */
    constructor(claimsCache) {
        super();
        this.claimsCache = claimsCache;
        // Chunk ordinal -> its border Graphics.
        this._graphics = new Map();
        this.visible = false;
        claimsCache.onUpdate(chunks => this._redrawChunks(chunks));
    }

    get layerIndex() {
        return 45;
    }

    /**
     * Hidden only in world mode; the borders read best zoomed out.
     * @param {ViewMode} mode
     * @returns {void}
     */
    setViewMode(mode) {
        this.visible = mode !== ViewMode.WORLD;
    }

    /**
     * @private
     * @param {number[]} chunks
     * @returns {void}
     */
    _redrawChunks(chunks) {
        for (const chunk of chunks) {
            const owner = this.claimsCache.ownerOf(chunk);
            if (owner === PLAYER_ID_NONE) {
                this._dropChunk(chunk);
            } else {
                this._drawChunk(chunk, owner);
            }
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
     * An inset border frame, plus a translucent fill for the own player's chunks.
     * @private
     * @param {number} chunk
     * @param {number} owner
     * @returns {void}
     */
    _drawChunk(chunk, owner) {
        const graphics = getOrCreate(this._graphics, chunk, () => {
            const created = new Graphics();
            const origin = chunkOrigin(chunk);
            created.position.set(origin.x * TILE_SIZE, origin.y * TILE_SIZE);
            this.addChild(created);
            return created;
        });
        graphics.clear();
        let color;
        let width;
        if (owner === this.claimsCache.ownPlayerId) {
            color = OWN_CLAIM_COLOR;
            width = OWN_BORDER_WIDTH;
            graphics
                .rect(0, 0, CHUNK_PX, CHUNK_PX)
                .fill({color, alpha: OWN_CLAIM_FILL_ALPHA});
        } else {
            color = claimColor(owner);
            width = BORDER_WIDTH;
        }
        graphics
            .rect(width / 2, width / 2, CHUNK_PX - width, CHUNK_PX - width)
            .stroke({color, width, alpha: CLAIM_BORDER_ALPHA});
    }
}
