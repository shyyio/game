import {Graphics} from "pixi.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import Mouse from "@/client/input/Mouse.js";

const MARQUEE_FILL_ALPHA = 0.12;
const MARQUEE_BORDER_WIDTH = 2;

/**
 * The rectangle a selection spans, from its start point to wherever the cursor aims now, with the
 * objects the selecting tool would take shown as placement targets.
 */
export class MarqueeLayer extends AbstractDrawLayer {

    /**
     * @param {PlacementFeedbackLayer} placementFeedbackLayer
     */
    constructor(placementFeedbackLayer) {
        super();
        this._placementFeedbackLayer = placementFeedbackLayer;
        this._graphics = new Graphics();
        this.addChild(this._graphics);
        // The fixed corner, in world px; null while no selection is open.
        this._startX = null;
        /** @type {AbstractSelectionTool|null} */
        this._tool = null;
        this._startY = null;
        // What the last draw spanned, so an unchanged frame draws nothing.
        this._drawnKey = null;
    }

    get layerIndex() {
        // Under the placement feedback, over every object.
        return 900;
    }

    /**
     * Stays visible in map mode: a selection reads at any zoom.
     * @param {boolean} value
     */
    set isMapMode(value) {}

    /**
     * Opens a selection at a world point; the other corner follows the cursor until {@link clear}.
     * @param {number} x
     * @param {number} y
     * @param {AbstractSelectionTool} tool
     * @returns {void}
     */
    start(x, y, tool) {
        this._tool = tool;
        this._startX = x;
        this._startY = y;
        this._draw();
    }

    clear() {
        this._startX = null;
        this._startY = null;
        this._tool = null;
        this._drawnKey = null;
        this._graphics.clear();
        this._placementFeedbackLayer.clear();
    }

    /**
     * @param {number} frame
     * @param {number} deltaMS
     * @param {Set<number>} visibleChunks
     */
    tick(frame, deltaMS, visibleChunks) {
        this._draw();
    }

    /**
     * @private
     * @returns {void}
     */
    _draw() {
        if (this._startX === null) {
            return;
        }
        const aim = Mouse.aimPoint();
        if (aim === null) {
            return;
        }
        const key = `${aim.x},${aim.y},${this.viewport.scale.x}`;
        if (key === this._drawnKey) {
            return;
        }
        this._drawnKey = key;
        this._graphics.clear();
        this._graphics
            .rect(
                Math.min(this._startX, aim.x),
                Math.min(this._startY, aim.y),
                Math.abs(aim.x - this._startX),
                Math.abs(aim.y - this._startY),
            )
            .fill({color: this._tool.marqueeColor, alpha: MARQUEE_FILL_ALPHA})
            // A screen-space border, whatever the zoom.
            .stroke({width: MARQUEE_BORDER_WIDTH / this.viewport.scale.x, color: this._tool.marqueeColor});
        const cells = [];
        for (const entry of this._tool.collectSelection(this.cache, this._startX, this._startY, aim.x, aim.y)) {
            for (const cell of entry.cells) {
                cells.push(cell);
            }
        }
        this._placementFeedbackLayer.show({clear: cells, shouldShowTarget: true, targetColor: this._tool.selectionColor});
    }
}
