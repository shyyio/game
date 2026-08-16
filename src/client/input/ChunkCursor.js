import {TILE_SIZE} from "@/client/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {chunkOrdinal, inRegion} from "@/common/util.js";
import {ClaimResult} from "@/common/ClaimEvents.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";

/**
 * The map-mode chunk cursor shared by the chunk-picking modes: which chunk is selected, and the
 * layers and panel that follow it.
 */
export class ChunkCursor {

    /**
     * @param {Client} client
     */
    constructor(client) {
        this._client = client;
        this._chunk = null;
    }

    /**
     * @returns {number|null}
     */
    get chunk() {
        return this._chunk;
    }

    /**
     * Routes a map-mode hover: center-lock selects the centered chunk, desktop only moves the
     * hover square; a null tile clears everything.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @returns {void}
     */
    handleHover(tileX, tileY) {
        if (tileX === null) {
            this.clear();
            return;
        }
        const chunk = this.chunkAt(tileX, tileY);
        if (this._client.centerLock) {
            this.select(chunk);
        } else {
            this._client.chunkSelectionLayer.setHoverChunk(chunk);
        }
    }

    /**
     * A map-mode tap selects the chunk under it; the claim shortcut (Shift+Click) also claims
     * it when claimable.
     * @param {number} tileX
     * @param {number} tileY
     * @param {boolean} [claimShortcut]
     * @returns {void}
     */
    handleSelect(tileX, tileY, claimShortcut = false) {
        const chunk = this.chunkAt(tileX, tileY);
        this.select(chunk);
        if (claimShortcut && chunk !== null) {
            const claims = this._client.cache.view("chunkClaims");
            if (claims.claimCheck(chunk) === ClaimResult.CLAIM_RESULT_OK) {
                this._client.sendMessage(new ClaimChunkMessage(chunk));
            }
        }
    }

    /**
     * Targets the chunk action stack and the selection square; null clears both. Re-selecting the
     * current chunk is free.
     * @param {number|null} chunk
     * @returns {void}
     */
    select(chunk) {
        if (chunk === this._chunk) {
            return;
        }
        this._chunk = chunk;
        this._client.chunkSelectionLayer.setSelectedChunk(chunk);
        this._client.chunkClaimsLayer.setSelectedChunk(chunk);
        this._client.claimFrontierLayer.setSelectedChunk(chunk);
        if (chunk === null) {
            this._client.chunkActionsLayer.hide();
        } else {
            this._client.chunkActionsLayer.showChunk(chunk);
        }
        // The active mode surfaces the new selection in its bars.
        this._client.chunkMode.updateIndicators();
    }

    /**
     * @returns {void}
     */
    selectCenterChunk() {
        const center = this._client.viewport.center;
        this.select(this.chunkAt(
            Math.floor(center.x / TILE_SIZE),
            Math.floor(center.y / TILE_SIZE),
        ));
    }

    /**
     * Drops the selection and any hover square.
     * @returns {void}
     */
    clear() {
        this.select(null);
        this._client.chunkSelectionLayer.setHoverChunk(null);
    }

    /**
     * The chunk under a tile, or null outside the region.
     * @param {number} tileX
     * @param {number} tileY
     * @returns {number|null}
     */
    chunkAt(tileX, tileY) {
        const chunkX = Math.floor(tileX / CHUNK_SIZE);
        const chunkY = Math.floor(tileY / CHUNK_SIZE);
        if (!inRegion(chunkX, chunkY)) {
            return null;
        }
        return chunkOrdinal(chunkX, chunkY);
    }
}
