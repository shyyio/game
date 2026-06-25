import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {Graphics} from "pixi.js";
import {TILE_SIZE} from "@/client/constants.js";

// Red square marking a tile the current placement is not allowed on: a
// semi-transparent fill with an opaque border.
const BLOCKED_TILE_COLOR = 0xF23030;
const BLOCKED_TILE_INSET = 10; // px inset on every side, so the square sits inside the tile
const BLOCKED_TILE_FILL_ALPHA = 0.4; // semi-transparent interior
const BLOCKED_TILE_BORDER_WIDTH = 4; // px opaque border

/**
 * Shared layer that marks tiles the current placement can't use with a red square; driven imperatively by tools.
 */
export class BlockedTilesLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._graphics = new Graphics();
        this.addChild(this._graphics);
    }

    get layerIndex() {
        // Above every object and ghost layer so the marker sits on top.
        return 1000;
    }

    onEvent(event) {
        // No-op: blocked tiles are driven by tool placement, not by game events.
    }

    /**
     * Marks the given tiles as blocked, replacing any previous (empty clears).
     * @param {{x: number, y: number}[]} tiles
     */
    show(tiles) {
        this._graphics.clear();
        tiles.forEach(tile => {
            this._graphics
                .rect(
                    tile.x * TILE_SIZE + BLOCKED_TILE_INSET,
                    tile.y * TILE_SIZE + BLOCKED_TILE_INSET,
                    TILE_SIZE - BLOCKED_TILE_INSET * 2,
                    TILE_SIZE - BLOCKED_TILE_INSET * 2,
                )
                .fill({color: BLOCKED_TILE_COLOR, alpha: BLOCKED_TILE_FILL_ALPHA})
                .stroke({width: BLOCKED_TILE_BORDER_WIDTH, color: BLOCKED_TILE_COLOR});
        });
    }

    clear() {
        this._graphics.clear();
    }
}
