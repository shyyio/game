import {Container, Graphics} from "pixi.js";
import {PANEL_TINT, PANEL_TINT_TEXT} from "@/client/Theme.js";

// Gap between the box's edges and its content.
export const TOOLTIP_PADDING = 8;
// Clearance from the screen edges the box is nudged back inside.
export const TOOLTIP_SCREEN_MARGIN = 8;
// A tooltip is for resting on a target, not for sweeping past one.
export const TOOLTIP_HOVER_DELAY_MS = 350;

const CORNER_RADIUS = 4;
const BORDER_ALPHA = 0.35;

/**
 * @abstract
 *
 * A plain filled box anchored beside a world point: the weight of a browser tooltip, not of a
 * panel. Screen-anchored, so it neither scales nor rotates with the world. Subclasses add their
 * own content and place the box.
 */
export class AbstractTooltipLayer extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this._app = app;
        // The game viewport, for mapping the target to the screen (set by the host).
        this.viewport = null;
        this.zIndex = 9500;
        this.visible = false;
        this.eventMode = "none";
        // The box's drawn size, so following it per frame costs no bounds walk.
        this._boxWidth = 0;
        this._boxHeight = 0;
        this._box = new Graphics();
        this.addChild(this._box);
    }

    /**
     * @returns {number}
     */
    get boxWidth() {
        return this._boxWidth;
    }

    /**
     * @returns {number}
     */
    get boxHeight() {
        return this._boxHeight;
    }

    /**
     * Repaints the box around content of the given size.
     * @param {number} contentWidth
     * @param {number} contentHeight
     * @returns {void}
     */
    drawBox(contentWidth, contentHeight) {
        this._boxWidth = contentWidth + TOOLTIP_PADDING * 2;
        this._boxHeight = contentHeight + TOOLTIP_PADDING * 2;
        this._box
            .clear()
            .roundRect(0, 0, this._boxWidth, this._boxHeight, CORNER_RADIUS)
            .fill(PANEL_TINT)
            .stroke({color: PANEL_TINT_TEXT, width: 1, alpha: BORDER_ALPHA});
    }

    /**
     * Puts the box at a world point plus a screen-space offset, nudged back inside the screen.
     * @param {number} worldX
     * @param {number} worldY
     * @param {number} offsetX
     * @param {number} offsetY
     * @returns {void}
     */
    placeAt(worldX, worldY, offsetX, offsetY) {
        const anchor = this.viewport.toScreen(worldX, worldY);
        const maxX = this._app.screen.width - this._boxWidth - TOOLTIP_SCREEN_MARGIN;
        const maxY = this._app.screen.height - this._boxHeight - TOOLTIP_SCREEN_MARGIN;
        this.x = clamp(anchor.x + offsetX, TOOLTIP_SCREEN_MARGIN, maxX);
        this.y = clamp(anchor.y + offsetY, TOOLTIP_SCREEN_MARGIN, maxY);
    }
}

/**
 * @param {number} value
 * @param {number} low
 * @param {number} high
 * @returns {number}
 */
function clamp(value, low, high) {
    return Math.min(Math.max(value, low), high);
}
