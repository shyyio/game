import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {Graphics} from "pixi.js";
import {
    TILE_SIZE,
    TARGET_TILE_COLOR,
    TARGET_TILE_FILL_ALPHA,
    TARGET_TILE_BORDER_WIDTH,
} from "@/client/constants.js";

// Per-tile placement feedback: a tile the placement can't use (red), one it would overwrite (blue),
// and — in center-lock only — the clear geometry tiles as the green target marker. Red/blue are
// inset warning markers; the green target fills the tile.
const BLOCKED_TILE_COLOR = 0xF23030;
const OVERWRITE_TILE_COLOR = 0x3098F2;
const TILE_INSET = 6; // px inset on every side for every feedback square, so it sits inside the tile
const MARKER_FILL_ALPHA = 0.4;
const MARKER_BORDER_WIDTH = 4;

/**
 * Shared placement-feedback layer, driven imperatively by tools: each geometry tile is marked blocked
 * (red), overwritable (blue), or — under center-lock, where the ghost sprite is pinned to screen
 * center — clear (the green target). One layer so the three never compete or drift apart.
 */
export class PlacementFeedbackLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._graphics = new Graphics();
        this.addChild(this._graphics);
        this._blocked = [];
        this._overwrite = [];
        this._clear = [];
        this._centerLock = false;
    }

    get layerIndex() {
        // Above every object and ghost layer so the feedback sits on top.
        return 1000;
    }

    onEvent(event) {
        // No-op: feedback tiles are driven by tool placement, not by game events.
    }

    /**
     * Shows the current placement's geometry feedback, replacing any previous (all empty clears).
     * @param {{x: number, y: number}[]} blockedTiles - marked red
     * @param {{x: number, y: number}[]} [overwriteTiles] - marked blue
     * @param {{x: number, y: number}[]} [clearTiles] - the green target, drawn only under center-lock
     */
    show(blockedTiles, overwriteTiles=[], clearTiles=[]) {
        this._blocked = blockedTiles;
        this._overwrite = overwriteTiles;
        this._clear = clearTiles;
        this._redraw();
    }

    setCenterLock(enabled) {
        this._centerLock = enabled;
        this._redraw();
    }

    clear() {
        this._blocked = [];
        this._overwrite = [];
        this._clear = [];
        this._graphics.clear();
    }

    /**
     * @private
     */
    _redraw() {
        this._graphics.clear();
        this._marker(this._blocked, BLOCKED_TILE_COLOR);
        this._marker(this._overwrite, OVERWRITE_TILE_COLOR);
        // The green target means "it lands here", so suppress it entirely when any cell is blocked
        // (placement is rejected); overwrite cells are still a valid placement, so green stays.
        if (this._centerLock && this._blocked.length === 0) {
            this._target(this._clear);
        }
    }

    /**
     * Inset warning square (red/blue).
     * @private
     */
    _marker(tiles, color) {
        tiles.forEach(tile => {
            this._graphics
                .rect(
                    tile.x * TILE_SIZE + TILE_INSET,
                    tile.y * TILE_SIZE + TILE_INSET,
                    TILE_SIZE - TILE_INSET * 2,
                    TILE_SIZE - TILE_INSET * 2,
                )
                .fill({color, alpha: MARKER_FILL_ALPHA})
                .stroke({width: MARKER_BORDER_WIDTH, color});
        });
    }

    /**
     * Green target square.
     * @private
     */
    _target(tiles) {
        tiles.forEach(tile => {
            this._graphics
                .rect(
                    tile.x * TILE_SIZE + TILE_INSET,
                    tile.y * TILE_SIZE + TILE_INSET,
                    TILE_SIZE - TILE_INSET * 2,
                    TILE_SIZE - TILE_INSET * 2,
                )
                .fill({color: TARGET_TILE_COLOR, alpha: TARGET_TILE_FILL_ALPHA})
                .stroke({width: TARGET_TILE_BORDER_WIDTH, color: TARGET_TILE_COLOR});
        });
    }
}
