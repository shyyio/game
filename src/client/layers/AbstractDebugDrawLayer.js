import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {NotImplementedError} from "@/common/error.js";

/**
 * A debug overlay: visible only in debug mode and out of map mode, repainted lazily on the next
 * tick after {@link markStale}.
 * @abstract
 */
export class AbstractDebugDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this.visible = false;
        this._debugMode = false;
        // Map mode (zoomed far out) is too coarse for an overlay; it hides regardless of debug mode.
        this._mapMode = false;
        this._stale = true;
    }

    /**
     * Shows the overlay in debug mode; hides it otherwise.
     * @param {boolean} enabled
     * @returns {void}
     */
    setDebugMode(enabled) {
        this._debugMode = enabled;
        this._updateVisibility();
    }

    /**
     * @param {boolean} value
     */
    set mapMode(value) {
        this._mapMode = value;
        this._updateVisibility();
    }

    /**
     * Marks the overlay for repaint on the next tick.
     * @returns {void}
     */
    markStale() {
        this._stale = true;
    }

    /**
     * @private
     * @returns {void}
     */
    _updateVisibility() {
        this.visible = this._debugMode && !this._mapMode;
        this._stale = true;
    }

    /**
     * Repaints when shown and stale.
     * @param {number} frame
     * @param {number} deltaMS
     * @param {Set<number>} visibleChunks
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        if (this.visible && this._stale) {
            this._stale = false;
            this._repaint();
        }
    }

    /**
     * Repaints the whole overlay.
     * @abstract
     * @returns {void}
     */
    _repaint() {
        throw new NotImplementedError();
    }
}
