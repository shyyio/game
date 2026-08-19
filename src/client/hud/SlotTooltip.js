import Mobile from "@/client/Mobile.js";
import {PANEL_TINT_TEXT} from "@/client/Theme.js";
import {panelText, TextRole} from "@/client/hud/PanelText.js";
import {SLOT_SIZE} from "@/client/hud/InspectSlot.js";
import {
    AbstractTooltipLayer,
    TOOLTIP_HOVER_DELAY_MS,
    TOOLTIP_PADDING,
} from "@/client/hud/AbstractTooltipLayer.js";

const EMPTY_NAME = "Empty";
// Clearance above the hovered slot.
const SLOT_CLEARANCE = 6;

/**
 * The hovered inspect slot's item name, in a tooltip box above the slot.
 */
export class SlotTooltip extends AbstractTooltipLayer {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super(app);
        // The hovered slot, and how long it has been held.
        this._target = null;
        this._heldMS = 0;
        this._name = panelText("", TextRole.BODY);
        this._name.x = TOOLTIP_PADDING;
        this._name.y = TOOLTIP_PADDING;
        this.addChild(this._name);
        this._tick = () => this._update(this._app.ticker.deltaMS);
        app.ticker.add(this._tick);
    }

    /**
     * Points the tooltip at a slot; a new slot restarts the dwell.
     * @param {InspectSlot} slot
     * @returns {void}
     */
    setTarget(slot) {
        if (slot === this._target) {
            return;
        }
        this._target = slot;
        this._heldMS = 0;
    }

    /**
     * Drops a slot's tooltip, ignoring a leave from a slot that no longer holds it.
     * @param {InspectSlot} slot
     * @returns {void}
     */
    clearTarget(slot) {
        if (slot === this._target) {
            this._target = null;
        }
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        this._name.style.fill = PANEL_TINT_TEXT;
        this._redraw();
    }

    /**
     * Follows the hovered slot once its dwell is served; the slot rides its panel's drags.
     * @param {number} deltaMS
     * @returns {void}
     * @private
     */
    _update(deltaMS) {
        // A closed panel destroys its slots without a leave event.
        if (this._target !== null && this._target.destroyed) {
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
        this._setName(this._target.itemName);
        this.visible = true;
        // A panel raised since the hover began would otherwise cover the box.
        this._raise();
        // The layer is the unscaled stage-origin HUD, so a slot's global position is its screen one.
        const anchor = this._target.getGlobalPosition();
        this.placeAtScreen(anchor.x, anchor.y, (SLOT_SIZE - this.boxWidth) / 2, -SLOT_CLEARANCE - this.boxHeight);
    }

    /**
     * @returns {void}
     * @private
     */
    _raise() {
        const siblings = this.parent.children;
        if (siblings[siblings.length - 1] !== this) {
            this.parent.addChild(this);
        }
    }

    /**
     * @param {string|null} name - null for an empty slot
     * @returns {void}
     * @private
     */
    _setName(name) {
        let label = EMPTY_NAME;
        if (name !== null) {
            label = name;
        }
        if (label === this._name.text) {
            return;
        }
        this._name.text = label;
        this._redraw();
    }

    /**
     * @returns {void}
     * @private
     */
    _redraw() {
        this.drawBox(this._name.width, this._name.height);
    }
}
