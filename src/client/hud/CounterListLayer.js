import {Container, Graphics, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {activeTheme, PROGRESS_TEXT_STROKE, THEME_HIGH_CONTRAST} from "@/client/Theme.js";
import {formatCount, formatExactCount} from "@/common/util.js";
import SafeArea from "@/client/SafeArea.js";
import {HudLayer} from "@/client/hud/HudLayer.js";

// Screen-pixel inset of the list from the left edge, and from whatever sits above it.
const MARGIN = 16;

const ROW_HEIGHT = 28;
// The box an icon paints inside; icons.js glyphs paint around their own center.
const ICON_SIZE = 16;
const ICON_GAP = 10;
const ICON_STROKE = 2;

// Dark: the list floats over the world, with no panel behind it. Each counter picks its own
// icon color.
const COUNTER_TEXT_COLOR = 0x000000;
// The high-contrast theme backs the glyphs with a halo; the default one leaves them bare.
const TEXT_STROKE_WIDTH = 3;

/**
 * What a counter looks like: its glyph, that glyph's color, and the name its tooltip gives it.
 * A contributor builds one per counter and hands it to {@link CounterListLayer.setCounter}.
 */
export class CounterEntry {

    /**
     * @param {function(Graphics, number, number): void} drawIcon - an icons.js glyph painter
     * @param {number} iconColor
     * @param {string} label
     */
    constructor(drawIcon, iconColor, label) {
        this.drawIcon = drawIcon;
        this.iconColor = iconColor;
        this.label = label;
    }
}

/**
 * One counter's row: its icon and abbreviated count, and the exact wording its tooltip shows.
 */
class CounterRow extends Container {

    /**
     * @param {CounterEntry} entry
     * @param {CounterTooltip} tooltip - raised while the pointer rests on this row
     */
    constructor(entry, tooltip) {
        super();
        this.entry = entry;
        this._count = 0;
        const icon = new Graphics();
        entry.drawIcon(icon, entry.iconColor, ICON_STROKE);
        icon.x = ICON_SIZE / 2;
        icon.y = ROW_HEIGHT / 2;
        this._text = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: 15, fill: COUNTER_TEXT_COLOR},
        });
        // Both anchor on the row's middle line, so they stay aligned whatever the font metrics are.
        this._text.anchor.set(0, 0.5);
        this._text.x = ICON_SIZE + ICON_GAP;
        this._text.y = ROW_HEIGHT / 2;
        this.addChild(icon);
        this.addChild(this._text);
        this.eventMode = "static";
        this.on("pointerenter", () => tooltip.setTarget(this));
        this.on("pointerleave", () => tooltip.clearTarget(this));
        this.restyle();
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        if (activeTheme() === THEME_HIGH_CONTRAST) {
            this._text.style.stroke = {color: PROGRESS_TEXT_STROKE, width: TEXT_STROKE_WIDTH};
            return;
        }
        this._text.style.stroke = null;
    }

    /**
     * @returns {string} the tooltip's wording, e.g. "10,000 × Credits"
     */
    get tooltipText() {
        return `${formatExactCount(this._count)} × ${this.entry.label}`;
    }

    /**
     * @param {number} count
     * @returns {void}
     */
    setCount(count) {
        this._count = count;
        this._text.text = formatCount(count);
    }
}

/**
 * Top-left list of the player's running counts (currency balance, and whatever else a core system
 * or mod contributes): one "icon count" row each, floating over the world with no background, the
 * exact amount on hover. Hidden while the top status bar occupies the edge, and while it holds no
 * counters.
 */
export class CounterListLayer extends Container {

    /**
     * @param {Application} app
     * @param {CounterTooltip} tooltip - the box the rows raise on hover
     */
    constructor(app, tooltip) {
        super();
        this._tooltip = tooltip;
        // Passive, not none: the rows themselves are the hover targets.
        this.eventMode = "passive";
        this.zIndex = HudLayer.CONTROL;
        this.visible = false;
        this._topOffset = 0;
        // Set while the top status bar occupies the top edge: the list stays out of its way.
        this._suppressed = false;
        // Counter id -> its row, in insertion order.
        this._rows = new Map();
        this._layout();
        app.renderer.on("resize", () => this._layout());
    }

    /**
     * Adds a counter, or updates the count under this id; a different entry replaces the row.
     * @param {string} id
     * @param {CounterEntry} entry
     * @param {number} count
     * @returns {void}
     */
    setCounter(id, entry, count) {
        const existing = this._rows.get(id);
        if (existing !== undefined && existing.entry === entry) {
            existing.setCount(count);
            return;
        }
        this.removeCounter(id);
        const row = new CounterRow(entry, this._tooltip);
        row.setCount(count);
        this.addChild(row);
        this._rows.set(id, row);
        this._layout();
    }

    /**
     * @param {string} id
     * @returns {void}
     */
    removeCounter(id) {
        const row = this._rows.get(id);
        if (row === undefined) {
            return;
        }
        this._rows.delete(id);
        this._tooltip.clearTarget(row);
        row.destroy({children: true});
        this._layout();
    }

    /**
     * Shifts the list down by `offset` px and, once the top status bar occupies the edge at all,
     * hides it: the bar owns that corner.
     * @param {number} offset
     * @param {boolean} barPresent
     * @returns {void}
     */
    setTopOffset(offset, barPresent) {
        this._topOffset = offset;
        this._suppressed = barPresent;
        this._layout();
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        for (const row of this._rows.values()) {
            row.restyle();
        }
    }

    /**
     * Re-stacks the rows clear of the left safe-area inset.
     * @private
     * @returns {void}
     */
    _layout() {
        this.visible = !this._suppressed && this._rows.size > 0;
        this.x = SafeArea.insets().left + MARGIN;
        this.y = this._topOffset + MARGIN;
        let y = 0;
        for (const row of this._rows.values()) {
            row.y = y;
            y += ROW_HEIGHT;
        }
    }
}
