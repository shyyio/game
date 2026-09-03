import Mobile from "@/client/Mobile.js";
import {PANEL_TINT_TEXT} from "@/client/Theme.js";
import {panelText, TextRole} from "@/client/hud/PanelText.js";
import {
    AbstractTooltipLayer,
    TOOLTIP_HOVER_DELAY_MS,
    TOOLTIP_PADDING,
} from "@/client/hud/AbstractTooltipLayer.js";

// Clearance from the hovered target.
export const TARGET_CLEARANCE = 6;

/**
 * Which edge of the target the tooltip box sits beside.
 * @enum
 */
export const TooltipSide = {
    RIGHT: 0,
    BELOW: 1,
};

/**
 * A hovered target's `tooltipText`, in a tooltip box beside it once the pointer has rested there.
 */
export class HoverTooltip extends AbstractTooltipLayer {

    /**
     * @param {Application} app
     * @param {number} side a TooltipSide
     * @param {number} zIndex a HudLayer band
     */
    constructor(app, side, zIndex) {
        super(app);
        this.zIndex = zIndex;
        this._side = side;
        // The hovered target, and how long it has been held.
        this._target = null;
        this._heldMS = 0;
        this._label = panelText("", TextRole.BODY);
        this._label.x = TOOLTIP_PADDING;
        this._label.y = TOOLTIP_PADDING;
        this.addChild(this._label);
        app.ticker.add(() => this._update(app.ticker.deltaMS));
    }

    /**
     * Points the tooltip at a target; a new target restarts the dwell.
     * @param {Container} target exposes `tooltipText`
     * @returns {void}
     */
    setTarget(target) {
        if (target === this._target) {
            return;
        }
        this._target = target;
        this._heldMS = 0;
    }

    /**
     * Drops a target's tooltip, ignoring a leave from a target that no longer holds it.
     * @param {Container} target
     * @returns {void}
     */
    clearTarget(target) {
        if (target === this._target) {
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
     * Follows the hovered target once its dwell is served.
     * @param {number} deltaMS
     * @returns {void}
     * @private
     */
    _update(deltaMS) {
        // A removed or rebuilt target is destroyed without a leave event.
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
        // The layer is the unscaled stage-origin HUD, so a target's global position is its screen one.
        const anchor = this._target.getGlobalPosition();
        if (this._side === TooltipSide.RIGHT) {
            this.placeAtScreen(anchor.x, anchor.y, this._target.width + TARGET_CLEARANCE, 0);
        } else {
            this.placeAtScreen(anchor.x, anchor.y, 0, this._target.height + TARGET_CLEARANCE);
        }
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
