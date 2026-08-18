import {Container, Graphics, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import Mobile from "@/client/Mobile.js";
import {PANEL_TINT, PANEL_TINT_TEXT} from "@/client/Theme.js";

const TEXT_SIZE = 15;
const PADDING = 8;
const CORNER_RADIUS = 4;
const BORDER_ALPHA = 0.35;
// Clearance above the bracket, and from the screen edges the box is nudged back inside.
const BRACKET_CLEARANCE = 28;
const SCREEN_MARGIN = 8;
// A label is for resting on an item, not for sweeping past one. A tap is deliberate already, so
// touch shows the name outright.
const HOVER_DELAY_MS = 350;

/**
 * The inspected item's name, drawn as a plain box above its bracket — the weight of a browser
 * tooltip, not of a panel. Screen-anchored, so it neither scales nor rotates with the world.
 */
export class InspectTooltipLayer extends Container {

    /**
     * @param {Application} app
     * @param {ItemInspectLayer} itemInspectLayer - the locked item this labels
     * @param {ItemDrawLayer} itemLayer - names the locked item's type
     */
    constructor(
        app,
        itemInspectLayer,
        itemLayer,
    ) {
        super();
        this._app = app;
        this._inspect = itemInspectLayer;
        this._itemLayer = itemLayer;
        // The game viewport, for mapping the bracketed item to the screen (set by the host).
        this.viewport = null;
        this.zIndex = 9500;
        this.visible = false;
        this.eventMode = "none";
        // The box's drawn size, so following it per frame costs no bounds walk.
        this._boxWidth = 0;
        this._boxHeight = 0;
        // The lock being labeled, and how long it has been held.
        this._lockVersion = null;
        this._heldMS = 0;

        this._box = new Graphics();
        this.addChild(this._box);
        this._text = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: TEXT_SIZE, fill: PANEL_TINT_TEXT},
        });
        this._text.x = PADDING;
        this._text.y = PADDING;
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
     * Tracks the locked item: a new lock restarts the dwell, and the box follows the bracket once
     * the dwell is served.
     * @private
     * @param {number} deltaMS
     * @returns {void}
     */
    _update(deltaMS) {
        const itemType = this._inspect.lockedItemType;
        if (itemType === null || this.viewport === null) {
            this.visible = false;
            this._lockVersion = null;
            return;
        }
        if (this._inspect.lockVersion !== this._lockVersion) {
            this._lockVersion = this._inspect.lockVersion;
            this._heldMS = 0;
            this._text.text = this._itemLayer.definitionFor(itemType).name;
            this._redraw();
        }
        this._heldMS += deltaMS;
        if (!Mobile.enabled && this._heldMS < HOVER_DELAY_MS) {
            this.visible = false;
            return;
        }
        this.visible = true;
        this._follow();
    }

    /**
     * @private
     * @returns {void}
     */
    _redraw() {
        this._boxWidth = this._text.width + PADDING * 2;
        this._boxHeight = this._text.height + PADDING * 2;
        this._box
            .clear()
            .roundRect(0, 0, this._boxWidth, this._boxHeight, CORNER_RADIUS)
            .fill(PANEL_TINT)
            .stroke({color: PANEL_TINT_TEXT, width: 1, alpha: BORDER_ALPHA});
    }

    /**
     * Centers the box above the bracket, nudged back inside the screen at the edges. Above, so a
     * fingertip never covers it.
     * @private
     * @returns {void}
     */
    _follow() {
        const point = this._inspect.lockedPoint;
        if (point === null) {
            return;
        }
        const anchor = this.viewport.toScreen(point.x, point.y);
        const maxX = this._app.screen.width - this._boxWidth - SCREEN_MARGIN;
        const maxY = this._app.screen.height - this._boxHeight - SCREEN_MARGIN;
        this.x = Math.min(Math.max(anchor.x - this._boxWidth / 2, SCREEN_MARGIN), maxX);
        this.y = Math.min(Math.max(anchor.y - BRACKET_CLEARANCE - this._boxHeight, SCREEN_MARGIN), maxY);
    }
}
