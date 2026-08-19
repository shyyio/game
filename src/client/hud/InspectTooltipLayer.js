import Mobile from "@/client/Mobile.js";
import {PANEL_TINT_TEXT} from "@/client/Theme.js";
import {panelText, TextRole} from "@/client/hud/PanelText.js";
import {
    AbstractTooltipLayer,
    TOOLTIP_HOVER_DELAY_MS,
    TOOLTIP_PADDING,
} from "@/client/hud/AbstractTooltipLayer.js";

// Clearance above the bracket.
const BRACKET_CLEARANCE = 28;

/**
 * The inspected item's name, in a tooltip box above its bracket.
 */
export class InspectTooltipLayer extends AbstractTooltipLayer {

    /**
     * @param {Application} app
     * @param {ItemInspectLayer} itemInspectLayer - the locked item this labels
     * @param {ItemRegistry} items - names the locked item's type
     */
    constructor(
        app,
        itemInspectLayer,
        items,
    ) {
        super(app);
        this._inspect = itemInspectLayer;
        this._items = items;
        // The item being labeled, and how long it has been held.
        this._item = null;
        this._heldMS = 0;
        this._text = panelText("", TextRole.BODY);
        this._text.x = TOOLTIP_PADDING;
        this._text.y = TOOLTIP_PADDING;
        this.addChild(this._text);
        this._tick = () => this._update(this._app.ticker.deltaMS);
        app.ticker.add(this._tick);
    }

    /**
     * Repaints for the current theme; the engine calls this on any HUD layer defining it.
     * @returns {void}
     */
    restyle() {
        this._text.style.fill = PANEL_TINT_TEXT;
        this._redraw();
    }

    /**
     * Follows the locked item once its dwell is served; a new lock restarts the dwell.
     * @private
     * @param {number} deltaMS
     * @returns {void}
     */
    _update(deltaMS) {
        const item = this._inspect.lockedItem;
        if (item === null || this.viewport === null) {
            this.visible = false;
            this._item = null;
            return;
        }
        if (item !== this._item) {
            this._item = item;
            this._heldMS = 0;
            this._setName(this._items.definitionFor(item.itemType).name);
        }
        this._heldMS += deltaMS;
        // A tap is deliberate already, so touch skips the dwell.
        if (!Mobile.enabled && this._heldMS < TOOLTIP_HOVER_DELAY_MS) {
            this.visible = false;
            return;
        }
        this.visible = true;
        // Centered above the bracket, clear of the fingertip.
        this.placeAt(item.x, item.y, -this.boxWidth / 2, -BRACKET_CLEARANCE - this.boxHeight);
    }

    /**
     * @private
     * @param {string} name
     * @returns {void}
     */
    _setName(name) {
        if (name === this._text.text) {
            return;
        }
        this._text.text = name;
        this._redraw();
    }

    /**
     * @private
     * @returns {void}
     */
    _redraw() {
        this.drawBox(this._text.width, this._text.height);
    }
}
