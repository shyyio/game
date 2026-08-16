import {Graphics} from "pixi.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {TILE_SIZE, ViewMode} from "@/client/constants.js";
import {CHUNK_SIZE, PLAYER_ID_NONE} from "@/common/constants.js";
import {chunkNeighbors, chunkOrigin} from "@/common/util.js";
import {claimColor} from "@/client/Theme.js";

const CHUNK_PX = CHUNK_SIZE * TILE_SIZE;

// Dashed frontier outline (map zoom) and tint fill (overworld zoom), in the own-claim color.
const DASH_WIDTH = TILE_SIZE / 2;
const DASH_LENGTH = TILE_SIZE * 4;
const DASH_GAP = TILE_SIZE * 4;
const FRONTIER_ALPHA = 0.8;
// Below the claims' CLAIM_FILL_ALPHA, so pending chunks read softer than owned ones.
const OVERWORLD_FILL_ALPHA = 0.4;

/**
 * The claim frontier: dashed squares (tint fills at overworld zoom) on the unclaimed chunks
 * edge-adjacent to the player's own, shown in claim selection mode once they hold a chunk.
 */
export class ClaimFrontierDrawLayer extends AbstractDrawLayer {

    /**
     * @param {ClientCache} state
     */
    constructor(state) {
        super();
        this._claims = state.view("chunkClaims");
        this._graphics = new Graphics();
        this.addChild(this._graphics);
        this._modeActive = false;
        this._zoomedOut = false;
        this._overworld = false;
        // The selected chunk's dashes hide, so the selection square replaces them.
        this._selectedChunk = null;
        // Batches the cache-driven redraw until the next tick.
        this._dirty = false;
        this.visible = false;
        // Deferred: a claim update writes ownerByChunk before ownChunks, so neither notify sees
        // both halves settled.
        state.subscribe("chunkClaims.ownerByChunk", () => this._markDirty());
        state.subscribe("chunkClaims.ownChunks", () => this._markDirty());
        state.subscribe("chunkClaims.ownPlayerId", () => this._markDirty());
        state.subscribe("chunkClaims.maxChunks", () => this._markDirty());
    }

    tick(frame, deltaMS, visibleChunks) {
        if (!this._dirty) {
            return;
        }
        this._redraw();
    }

    /**
     * @private
     * @returns {void}
     */
    _markDirty() {
        this._dirty = true;
    }

    get layerIndex() {
        return 46;
    }

    /**
     * Follows claim selection mode; the frontier is that mode's affordance.
     * @param {boolean} active
     * @returns {void}
     */
    setModeActive(active) {
        if (active === this._modeActive) {
            return;
        }
        this._modeActive = active;
        this._redraw();
    }

    /**
     * @param {number|null} chunk
     * @returns {void}
     */
    setSelectedChunk(chunk) {
        if (chunk === this._selectedChunk) {
            return;
        }
        this._selectedChunk = chunk;
        this._redraw();
    }

    /**
     * Shown zoomed out (map and overworld) only; the zoom band picks the style.
     * @param {ViewMode} mode
     * @returns {void}
     */
    setViewMode(mode) {
        this._zoomedOut = mode !== ViewMode.WORLD;
        this._overworld = mode === ViewMode.OVERWORLD;
        this._redraw();
    }

    /**
     * The unclaimed chunks edge-adjacent to the own player's.
     * @private
     * @returns {Set<number>}
     */
    _frontier() {
        const frontier = new Set();
        for (const chunk of this._claims.ownChunks()) {
            for (const neighbor of chunkNeighbors(chunk)) {
                if (this._claims.ownerOf(neighbor) === PLAYER_ID_NONE) {
                    frontier.add(neighbor);
                }
            }
        }
        return frontier;
    }

    /**
     * @private
     * @returns {void}
     */
    _redraw() {
        this._dirty = false;
        this._graphics.clear();
        // At the chunk limit nothing is claimable, so the frontier has nothing to offer.
        this.visible = this._modeActive && this._zoomedOut && !this._claims.atChunkLimit();
        if (!this.visible) {
            return;
        }
        for (const chunk of this._frontier()) {
            if (chunk === this._selectedChunk) {
                continue;
            }
            const origin = chunkOrigin(chunk);
            const originX = origin.x * TILE_SIZE;
            const originY = origin.y * TILE_SIZE;
            if (this._overworld) {
                this._graphics.rect(originX, originY, CHUNK_PX, CHUNK_PX);
            } else {
                this._dashedSquare(originX, originY);
            }
        }
        let alpha;
        if (this._overworld) {
            alpha = OVERWORLD_FILL_ALPHA;
        } else {
            alpha = FRONTIER_ALPHA;
        }
        this._graphics.fill({color: claimColor(this._claims.ownPlayerId), alpha});
    }

    /**
     * Dash strips along the chunk's four edges.
     * @private
     * @param {number} originX
     * @param {number} originY
     * @returns {void}
     */
    _dashedSquare(originX, originY) {
        for (let offset = 0; offset < CHUNK_PX; offset += DASH_LENGTH + DASH_GAP) {
            const length = Math.min(DASH_LENGTH, CHUNK_PX - offset);
            this._graphics.rect(originX + offset, originY, length, DASH_WIDTH);
            this._graphics.rect(originX + offset, originY + CHUNK_PX - DASH_WIDTH, length, DASH_WIDTH);
            this._graphics.rect(originX, originY + offset, DASH_WIDTH, length);
            this._graphics.rect(originX + CHUNK_PX - DASH_WIDTH, originY + offset, DASH_WIDTH, length);
        }
    }
}
