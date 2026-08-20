import Mobile from "@/client/Mobile.js";
import {PANEL_TINT_TEXT} from "@/client/Theme.js";
import {panelText, TextRole} from "@/client/hud/PanelText.js";
import {
    AbstractTooltipLayer,
    TOOLTIP_HOVER_DELAY_MS,
    TOOLTIP_PADDING,
} from "@/client/hud/AbstractTooltipLayer.js";

// Clearance from the hovered row.
const ROW_CLEARANCE = 6;

/**
 * The hovered counter's label and exact amount ("10,000 × Credits"), in a tooltip box beside the row.
 */
export class CounterTooltip extends AbstractTooltipLayer {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super(app);
        // The hovered row, and how long it has been held.
        this._target = null;
        this._heldMS = 0;
        this._label = panelText("", TextRole.BODY);
        this._label.x = TOOLTIP_PADDING;
        this._label.y = TOOLTIP_PADDING;
        this.addChild(this._label);
        app.ticker.add(() => this._update(app.ticker.deltaMS));
    }

    /**
     * Points the tooltip at a counter row; a new row restarts the dwell.
     * @param {CounterRow} row
     * @returns {void}
     */
    setTarget(row) {
        if (row === this._target) {
            return;
        }
        this._target = row;
        this._heldMS = 0;
    }

    /**
     * Drops a row's tooltip, ignoring a leave from a row that no longer holds it.
     * @param {CounterRow} row
     * @returns {void}
     */
    clearTarget(row) {
        if (row === this._target) {
            this._target = null;
        }
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        this._label.style.fill = PANEL_TINT_TEXT;
        this._redraw();
    }

    /**
     * Follows the hovered row once its dwell is served.
     * @param {number} deltaMS
     * @returns {void}
     * @private
     */
    _update(deltaMS) {
        // A removed counter destroys its row without a leave event.
        if (this._target !== null && (this._target.destroyed || !this._target.visible)) {
            this._target = null;
        }
        if (this._target === null) {
            this.visible = false;
            return;
        }
        this._heldMS += deltaMS;
        // A tap is deliberate already, so touch skips the dwell.
        if (!Mobile.enabled && this._heldMS < TOOLTIP_HOVER_DELAY_MS) {
            this.visible = false;
            return;
        }
        this._setText(this._target.tooltipText);
        this.visible = true;
        // The layer is the unscaled stage-origin HUD, so a row's global position is its screen one.
        const anchor = this._target.getGlobalPosition();
        this.placeAtScreen(anchor.x, anchor.y, this._target.width + ROW_CLEARANCE, 0);
    }

    /**
     * @param {string} text
     * @returns {void}
     * @private
     */
    _setText(text) {
        if (text === this._label.text) {
            return;
        }
        this._label.text = text;
        this._redraw();
    }

    /**
     * @returns {void}
     * @private
     */
    _redraw() {
        this.drawBox(this._label.width, this._label.height);
    }
}
