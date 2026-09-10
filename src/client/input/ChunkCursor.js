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
    get chunkKey() {
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
        const chunkKey = this.findChunkKeyAt(tileX, tileY);
        if (this._client.centerLock.enabled) {
            this.select(chunkKey);
        } else {
            this._client.chunkSelectionLayer.setHoverChunk(chunkKey);
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
        const chunkKey = this.findChunkKeyAt(tileX, tileY);
        this.select(chunkKey);
        if (claimShortcut && chunkKey !== null) {
            const claims = this._client.cache.view("chunkClaims");
            if (claims.claimCheck(chunkKey) === ClaimResult.CLAIM_RESULT_OK) {
                this._client.sendMessage(new ClaimChunkMessage(chunkKey));
            }
        }
    }

    /**
     * Targets the chunk action stack and the selection square; null clears both. Re-selecting the
     * current chunk is free.
     * @param {number|null} chunkKey
     * @returns {void}
     */
    select(chunkKey) {
        if (chunkKey === this._chunk) {
            return;
        }
        this._chunk = chunkKey;
        this._client.chunkSelectionLayer.setSelectedChunk(chunkKey);
        this._client.chunkClaimsLayer.setSelectedChunk(chunkKey);
        this._client.claimFrontierLayer.setSelectedChunk(chunkKey);
        if (chunkKey === null) {
            this._client.hud.chunkActionsLayer.hide();
        } else {
            this._client.hud.chunkActionsLayer.showChunk(chunkKey);
        }
        // The active mode surfaces the new selection in its bars.
        this._client.chunkMode.updateIndicators();
    }

    /**
     * @returns {void}
     */
    selectCenterChunk() {
        const center = this._client.viewport.center;
        this.select(this.findChunkKeyAt(
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
    findChunkKeyAt(tileX, tileY) {
        const chunkX = Math.floor(tileX / CHUNK_SIZE);
        const chunkY = Math.floor(tileY / CHUNK_SIZE);
        if (!inRegion(chunkX, chunkY)) {
            return null;
        }
        return chunkOrdinal(chunkX, chunkY);
    }
}
