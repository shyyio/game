import Mouse from "@/client/input/Mouse.js";
import {TILE_SIZE, ViewMode} from "@/client/constants.js";
import {Direction} from "@/common/constants.js";
import {Container, Graphics} from "pixi.js";
import {HudLayer} from "@/client/hud/HudLayer.js";

const DOT_RADIUS = 3;
const MARKER_COLOR = 0x222222; // dark: must read on the white map background
const MARKER_ALPHA = 0.9;

/**
 * Screen-center dot marking the center-lock aim point. A screen-space HUD on app.stage;
 * the host toggles it.
 */
class CenterMarkerLayer extends Container {

    /**
     * @param {Application} app
     * @param {ClientViewport} viewport - the aim point is its screen center
     */
    constructor(app, viewport) {
        super();
        this._viewport = viewport;
        // Display-only: never a hit target (the stage is interactive for mobile pinch).
        this.eventMode = "none";
        this.zIndex = HudLayer.WORLD_MARKER;
        this.visible = false;
        const dot = new Graphics()
            .circle(0, 0, DOT_RADIUS)
            .fill({color: MARKER_COLOR, alpha: MARKER_ALPHA});
        this.addChild(dot);
        this._center();
        app.renderer.on("resize", () => this._center());
    }

    /**
     * @param {boolean} isActive
     * @returns {void}
     */
    setActive(isActive) {
        if (isActive) {
            this._center();
        }
        this.visible = isActive;
    }

    /**
     * Matches Mouse._centerTile: the viewport's screen center, not the renderer's.
     * @private
     * @returns {void}
     */
    _center() {
        this.x = Math.round(this._viewport.screenWidth / 2);
        this.y = Math.round(this._viewport.screenHeight / 2);
    }
}

/**
 * The mobile aim mode: hover and placement pin to the screen center, and the player pans the world
 * under the crosshair instead of moving a cursor over it.
 */
export class CenterLockMode {

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
        this.resyncMarker();
    }

    /**
     * The center aim dot follows whichever chunk-picking mode is on, center-lock only.
     * @returns {void}
     */
    resyncMarker() {
        const picking = this._client.chunkMode.active;
        this.markerLayer.setActive(this._enabled && picking && this._client.viewMode.current !== ViewMode.WORLD);
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
