import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {Graphics} from "pixi.js";
import {TILE_SIZE} from "@/client/constants.js";
import {
    TARGET_TILE_COLOR,
    TARGET_TILE_FILL_ALPHA,
    TARGET_TILE_BORDER_WIDTH,
    BLOCKED_TILE_COLOR,
    OVERWRITE_TILE_COLOR,
} from "@/client/Theme.js";

// Per-tile placement feedback: a tile the placement can't use (red), one it would overwrite (blue),
// and — in center-lock only — the clear geometry tiles as the green target marker. Red/blue are
// inset warning markers; the green target fills the tile.
const TILE_INSET = 8; // px inset on every side for every feedback square, so it sits inside the tile
const MARKER_FILL_ALPHA = 0.4;
const MARKER_BORDER_WIDTH = 4;
const FEEDBACK_ALPHA = 0.6; // overall opacity so the ghost sprite shows through the highlights

/**
 * Shared placement-feedback layer, driven imperatively by tools: each geometry tile is marked blocked
 * (red), overwritable (blue), or — under center-lock, where the ghost sprite is pinned to screen
 * center — clear (the green target). One layer so the three never compete or drift apart.
 */
export class PlacementFeedbackLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._graphics = new Graphics();
        this._graphics.alpha = FEEDBACK_ALPHA;
        this.addChild(this._graphics);
        this._blocked = [];
        this._overwrite = [];
        this._clear = [];
        // Persistent blue highlight of valid target tiles (e.g. resources under an extractor tool);
        // set on tool activation, independent of the per-hover geometry feedback.
        this._highlight = [];
        // Whether to draw the green clear target off center-lock (the cursor-follow ghost floats, so
        // the target marks where it actually lands).
        this._showTarget = false;
        this._centerLock = false;
    }

    get layerIndex() {
        // Above every object and ghost layer so the feedback sits on top.
        return 1000;
    }

    /**
     * Stays visible in map mode: placement feedback reads at any zoom.
     * @param {boolean} value
     */
    set mapMode(value) {}

    /**
     * Shows the current placement's geometry feedback, replacing any previous.
     * @param {{blocked?: {x: number, y: number}[], overwrite?: {x: number, y: number}[], clear?: {x: number, y: number}[], showTarget?: boolean}} feedback
     *     - blocked (red), overwrite (blue), clear (green target); showTarget draws the green target
     *       even off center-lock (for a cursor-follow ghost)
     */
    show({blocked=[], overwrite=[], clear=[], showTarget=false}) {
        this._blocked = blocked;
        this._overwrite = overwrite;
        this._clear = clear;
        this._showTarget = showTarget;
        this._redraw();
    }

    setCenterLock(enabled) {
        this._centerLock = enabled;
        this._redraw();
    }

    /**
     * Sets the persistent blue highlight of valid target tiles, replacing any previous. Survives the
     * per-hover `clear()`; cleared with `clearHighlight()`.
     * @param {{x: number, y: number}[]} tiles
     */
    highlight(tiles) {
        this._highlight = tiles;
        this._redraw();
    }

    clearHighlight() {
        this._highlight = [];
        this._redraw();
    }

    clear() {
        this._blocked = [];
        this._overwrite = [];
        this._clear = [];
        this._redraw();
    }

    /**
     * @private
     */
    _redraw() {
        this._graphics.clear();
        // The persistent target highlight (blue) sits under the per-hover markers.
        this._target(this._highlight, OVERWRITE_TILE_COLOR);
        this._marker(this._blocked, BLOCKED_TILE_COLOR);
        this._marker(this._overwrite, OVERWRITE_TILE_COLOR);
        // The green target means "it lands here", so suppress it entirely when any cell is blocked
        // (placement is rejected); overwrite cells are still a valid placement, so green stays.
        if ((this._centerLock || this._showTarget) && this._blocked.length === 0) {
            this._target(this._clear);
        }
    }

    /**
     * Inset warning square (red/blue).
     * @private
     */
    _marker(tiles, color) {
        for (const tile of tiles) {
            this._graphics
                .rect(
                    tile.x * TILE_SIZE + TILE_INSET,
                    tile.y * TILE_SIZE + TILE_INSET,
                    TILE_SIZE - TILE_INSET * 2,
                    TILE_SIZE - TILE_INSET * 2,
                )
                .fill({color, alpha: MARKER_FILL_ALPHA})
                .stroke({width: MARKER_BORDER_WIDTH, color});
        }
    }

    /**
     * Filled target square (green placement target, or another color for a persistent highlight).
     * @private
     */
    _target(tiles, color=TARGET_TILE_COLOR) {
        for (const tile of tiles) {
            this._graphics
                .rect(
                    tile.x * TILE_SIZE + TILE_INSET,
                    tile.y * TILE_SIZE + TILE_INSET,
                    TILE_SIZE - TILE_INSET * 2,
                    TILE_SIZE - TILE_INSET * 2,
                )
                .fill({color, alpha: TARGET_TILE_FILL_ALPHA})
                .stroke({width: TARGET_TILE_BORDER_WIDTH, color});
        }
    }
}
