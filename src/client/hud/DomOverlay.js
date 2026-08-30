import {HUD_DOM_Z_INDEX} from "@/client/hud/HudLayer.js";

// Every overlay starts parked at a 1px rect in the top-left corner, until the first sync places it.
const BASE_STYLE = {
    position: "fixed",
    zIndex: HUD_DOM_Z_INDEX,
    left: "0px",
    top: "0px",
    width: "1px",
    height: "1px",
};

/**
 * A DOM element floated over the pixi canvas and kept glued to a display object's screen rect: the
 * browser owns what the element does (typing, selection, an SVG chart), pixi decides where it sits.
 */
export class DomOverlay {

    /**
     * @param {HTMLElement} element - already appended to the document; the caller owns its tag and
     *     attributes
     * @param {object} [style] - styles layered over the overlay base
     */
    constructor(element, style = {}) {
        this.element = element;
        Object.assign(element.style, BASE_STYLE, style);
        // Last rect actually written; skips the style writes on the (overwhelming majority of)
        // ticks where nothing moved.
        this._left = null;
        this._top = null;
        this._width = null;
        this._height = null;
    }

    /**
     * Moves the element onto `bounds`, mapped from canvas space through the canvas's page rect.
     * @param {Bounds} bounds - canvas-space bounds of the display object being overlaid
     * @param {DOMRect} canvasRect
     * @returns {boolean} whether the rect changed, so a caller can follow a move up
     */
    sync(bounds, canvasRect) {
        const left = canvasRect.left + bounds.x;
        const top = canvasRect.top + bounds.y;
        const width = Math.max(bounds.width, 1);
        const height = Math.max(bounds.height, 1);
        if (left === this._left && top === this._top && width === this._width && height === this._height) {
            return false;
        }
        this._left = left;
        this._top = top;
        this._width = width;
        this._height = height;
        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
        this.element.style.width = `${width}px`;
        this.element.style.height = `${height}px`;
        return true;
    }

    /**
     * Forgets the last synced rect, so the next {@link sync} writes even where it computes the same
     * one; for an overlay pointed at a different display object.
     * @returns {void}
     */
    invalidate() {
        this._left = null;
        this._top = null;
        this._width = null;
        this._height = null;
    }

    /**
     * @returns {void}
     */
    remove() {
        this.element.remove();
    }
}
