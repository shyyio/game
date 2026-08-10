import {Container, Graphics} from "pixi.js";

const DOT_RADIUS = 3;
const MARKER_COLOR = 0x222222; // dark: must read on the white map background
const MARKER_ALPHA = 0.9;

/**
 * Screen-center dot marking the center-lock aim point. A screen-space HUD on app.stage;
 * the host toggles it.
 */
export class CenterMarkerLayer extends Container {

    /**
     * @param {Application} app
     * @param {ClientViewport} viewport - the aim point is its screen center
     */
    constructor(app, viewport) {
        super();
        this._viewport = viewport;
        // Display-only: never a hit target (the stage is interactive for mobile pinch).
        this.eventMode = "none";
        this.zIndex = 800;
        this.visible = false;
        const dot = new Graphics()
            .circle(0, 0, DOT_RADIUS)
            .fill({color: MARKER_COLOR, alpha: MARKER_ALPHA});
        this.addChild(dot);
        this._center();
        app.renderer.on("resize", () => this._center());
    }

    /**
     * @param {boolean} active
     * @returns {void}
     */
    setActive(active) {
        if (active) {
            this._center();
        }
        this.visible = active;
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
