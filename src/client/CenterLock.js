import Mouse from "@/client/input/Mouse.js";
import {CenterMarkerLayer} from "@/client/layers/CenterMarkerLayer.js";
import {TILE_SIZE, ViewMode} from "@/client/constants.js";
import {Direction} from "@/common/constants.js";

/**
 * The mobile aim mode: hover and placement pin to the screen center, and the player pans the world
 * under the crosshair instead of moving a cursor over it.
 */
export class CenterLock {

    /**
     * @param {Client} client
     */
    constructor(client) {
        this._client = client;
        this._enabled = false;
        // Center-lock aim point for claim selection (mobile).
        this.markerLayer = new CenterMarkerLayer(client.app, client.viewport);
    }

    /**
     * @returns {boolean}
     */
    get enabled() {
        return this._enabled;
    }

    /**
     * Toggles center-lock: pins hover/placement and the preview to the screen center.
     * @param {boolean} enabled
     * @returns {void}
     */
    setEnabled(enabled) {
        if (enabled === this._enabled) {
            return;
        }
        this._enabled = enabled;
        // Draw layers before the input layer, so a hover Mouse emits renders with center-lock on.
        this._client.drawLayerRegistry.setCenterLock(enabled);
        Mouse.setCenterLock(enabled);
        this.refreshMarker();
    }

    /**
     * The center aim dot follows whichever chunk-picking mode is on, center-lock only.
     * @returns {void}
     */
    refreshMarker() {
        const picking = this._client.chunkMode.active;
        this.markerLayer.setActive(this._enabled && picking && this._client.viewMode !== ViewMode.WORLD);
    }

    /**
     * Eases the viewport `tiles` tiles from (tileX, tileY) along `direction` so consecutive taps
     * lay a line; a no-op off center-lock.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @param {number} [tiles] - how many tiles to advance (default 1)
     * @returns {void}
     */
    advance(tileX, tileY, direction, tiles = 1) {
        if (!this._enabled) {
            return;
        }
        // Absolute next-tile center so rapid taps don't drift.
        const targetTileX = tileX + Direction.dx(direction) * tiles;
        const targetTileY = tileY + Direction.dy(direction) * tiles;
        this._client.viewport.glideTo({
            x: targetTileX * TILE_SIZE + TILE_SIZE / 2,
            y: targetTileY * TILE_SIZE + TILE_SIZE / 2,
        });
    }

}
