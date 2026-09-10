import {Graphics} from "pixi.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {CHUNK_PX, TILE_SIZE, ViewMode} from "@/client/constants.js";
import {ClaimResult} from "@/common/ClaimEvents.js";
import {chunkOrigin} from "@/common/util.js";
import Mobile from "@/client/Mobile.js";
import {
    CHUNK_SELECT_COLOR,
    CHUNK_SELECT_ALPHA,
    CHUNK_SELECT_FILL_ALPHA,
    CHUNK_HOVER_COLOR,
    CHUNK_HOVER_ALPHA,
    TARGET_TILE_COLOR,
    BLOCKED_TILE_COLOR,
} from "@/client/Theme.js";

// Matches the map-zoom claim borders (one tile).
const OUTLINE_WIDTH = TILE_SIZE;

// Pulse period and alpha band of the selection square.
const PULSE_PERIOD_MS = 600;
const PULSE_ALPHA_MIN = 0.5;
const PULSE_ALPHA_MAX = 1;

/**
 * Map/overworld chunk cursor: a pulsing square on the selected chunk colored by claim state,
 * and a lighter static square on the hovered chunk. The host feeds both chunks.
 */
export class ChunkSelectionLayer extends AbstractDrawLayer {

    /**
     * @param {ChunkClaimsView} claims
     */
    constructor(claims) {
        super();
        this._claims = claims;
        this._selection = new Graphics();
        this._hover = new Graphics();
        this.addChild(this._hover);
        this.addChild(this._selection);
        this._selectedChunk = null;
        this._hoverChunk = null;
        this._overworld = false;
        this._phaseMs = 0;
        this.visible = false;
    }

    get layerIndex() {
        return 47;
    }

    /**
     * Shown zoomed out (map and overworld) only; the zoom band picks the selection style.
     * @param {ViewMode} mode
     * @returns {void}
     */
    setViewMode(mode) {
        this.visible = mode !== ViewMode.WORLD;
        const overworld = mode === ViewMode.OVERWORLD;
        if (overworld !== this._overworld) {
            this._overworld = overworld;
            this._drawSelection();
        }
    }

    /**
     * @param {number|null} chunkKey
     * @returns {void}
     */
    setSelectedChunk(chunkKey) {
        if (chunkKey === this._selectedChunk) {
            return;
        }
        this._selectedChunk = chunkKey;
        this._drawSelection();
        // The hover square yields to the selection square on the same chunk.
        this._drawHover();
    }

    /**
     * No-op on mobile: there's no cursor to hover with, only the center-locked selection square.
     * @param {number|null} chunkKey
     * @returns {void}
     */
    setHoverChunk(chunkKey) {
        if (Mobile.isEnabled) {
            chunkKey = null;
        }
        if (chunkKey === this._hoverChunk) {
            return;
        }
        this._hoverChunk = chunkKey;
        this._drawHover();
    }

    /**
     * Drops any hover square left over from before mobile mode engaged.
     * @param {boolean} enabled
     * @returns {void}
     */
    setCenterLock(enabled) {
        if (enabled) {
            this.setHoverChunk(null);
        }
    }

    /**
     * Recolors the selection after a claim change.
     * @returns {void}
     */
    resync() {
        this._drawSelection();
    }

    tick(frame, deltaMS, visibleChunks) {
        if (!this.visible || this._selectedChunk === null) {
            return;
        }
        this._phaseMs = (this._phaseMs + deltaMS) % PULSE_PERIOD_MS;
        const wave = (Math.sin((this._phaseMs / PULSE_PERIOD_MS) * Math.PI * 2) + 1) / 2;
        this._selection.alpha = PULSE_ALPHA_MIN + wave * (PULSE_ALPHA_MAX - PULSE_ALPHA_MIN);
    }

    /**
     * The selection square's color from the chunk's claim state: claimable green, own
     * claimed chunk blue, anything else red.
     * @private
     * @returns {number}
     */
    _selectionColor() {
        const chunkKey = this._selectedChunk;
        if (this._claims.getOwnerByChunkKey(chunkKey) === this._claims.ownPlayerRef) {
            return CHUNK_SELECT_COLOR;
        }
        if (this._claims.claimCheck(chunkKey) === ClaimResult.CLAIM_RESULT_OK) {
            return TARGET_TILE_COLOR;
        }
        return BLOCKED_TILE_COLOR;
    }

    /**
     * At map zoom a border plus a lighter fill; at overworld zoom a full-opacity fill alone.
     * @private
     * @returns {void}
     */
    _drawSelection() {
        this._selection.clear();
        if (this._selectedChunk === null) {
            return;
        }
        const color = this._selectionColor();
        const origin = chunkOrigin(this._selectedChunk);
        if (this._overworld) {
            this._selection
                .rect(origin.x * TILE_SIZE, origin.y * TILE_SIZE, CHUNK_PX, CHUNK_PX)
                .fill({color, alpha: 1});
            return;
        }
        this._selection
            .rect(origin.x * TILE_SIZE, origin.y * TILE_SIZE, CHUNK_PX, CHUNK_PX)
            .fill({color, alpha: CHUNK_SELECT_FILL_ALPHA});
        this._insetOutline(this._selection, origin, color, CHUNK_SELECT_ALPHA);
    }

    /**
     * @private
     * @returns {void}
     */
    _drawHover() {
        let chunkKey = this._hoverChunk;
        if (chunkKey === this._selectedChunk) {
            chunkKey = null;
        }
        this._draw(this._hover, chunkKey, CHUNK_HOVER_COLOR, CHUNK_HOVER_ALPHA);
    }

    /**
     * An inset outline square over `chunk`; nothing for null.
     * @private
     * @param {Graphics} graphics
     * @param {number|null} chunkKey
     * @param {number} color
     * @param {number} alpha
     * @returns {void}
     */
    _draw(graphics, chunkKey, color, alpha) {
        graphics.clear();
        if (chunkKey === null) {
            return;
        }
        this._insetOutline(graphics, chunkOrigin(chunkKey), color, alpha);
    }

    /**
     * An outline square inset so the stroke stays inside the chunk.
     * @private
     * @param {Graphics} graphics
     * @param {{x: number, y: number}} origin
     * @param {number} color
     * @param {number} alpha
     * @returns {void}
     */
    _insetOutline(graphics, origin, color, alpha) {
        graphics
            .rect(
                origin.x * TILE_SIZE + OUTLINE_WIDTH / 2,
                origin.y * TILE_SIZE + OUTLINE_WIDTH / 2,
                CHUNK_PX - OUTLINE_WIDTH,
                CHUNK_PX - OUTLINE_WIDTH,
            )
            .stroke({color, width: OUTLINE_WIDTH, alpha});
    }
}
