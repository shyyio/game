import {PANEL_TINT, PANEL_BORDER} from "@/client/Theme.js";
import {UIPanel} from "@/client/hud/UIPanel.js";
import {buildPanelButton, hotkeyLabel} from "@/client/hud/panelButton.js";
import {
    AbstractEdgeBarLayer,
    EDGE_BLEED,
    FRAME_MARGIN,
    MIN_TEXT_WIDTH,
    PATTERN_GAP,
    TEXT_PADDING,
    THIN_PATTERN_WIDTH,
} from "@/client/hud/AbstractEdgeBarLayer.js";
import SafeArea from "@/client/SafeArea.js";

// Gap between adjacent floating buttons.
const BUTTON_GAP = 8;
// Gap between joined section texts, when more than one section is active at once.
const TEXT_GAP = "   ";

/**
 * One button in a status-bar section: a label and its press handler.
 */
export class StatusBarButton {

    /**
     * @param {string} label
     * @param {function(): void} onClick
     */
    constructor(label, onClick) {
        this.label = label;
        this.onClick = onClick;
    }
}

/**
 * Builds a status-bar button whose label carries its keyboard hint, dropped on touch input.
 * @param {string} label
 * @param {string} key
 * @param {function(): void} onClick
 * @returns {StatusBarButton}
 */
export function hotkeyButton(label, key, onClick) {
    return new StatusBarButton(hotkeyLabel(label, key), onClick);
}

/**
 * One caller's contribution to the top status bar: a text line and its buttons, owned by id.
 */
export class StatusBarSection {

    /**
     * @param {string} text
     * @param {StatusBarButton[]} [buttons]
     * @param {number} [order] - left-to-right position among concurrent sections
     */
    constructor(text, buttons = [], order = 0) {
        this.text = text;
        this.buttons = buttons;
        this.order = order;
    }
}

/**
 * @param {StatusBarSection|null} a
 * @param {StatusBarSection|null} b
 * @returns {boolean}
 */
function sectionsEqual(a, b) {
    if (a === b) {
        return true;
    }
    if (a === null || b === null) {
        return false;
    }
    if (a.text !== b.text || a.order !== b.order || a.buttons.length !== b.buttons.length) {
        return false;
    }
    for (let i = 0; i < a.buttons.length; i++) {
        if (a.buttons[i].label !== b.buttons[i].label) {
            return false;
        }
    }
    return true;
}

/**
 * Full-width status bar docked to the top: sections' buttons, a pattern, then centered joined text.
 */
export class TopStatusBarLayer extends AbstractEdgeBarLayer {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super(app);
        /** @type {Map<string, StatusBarSection>} */
        this._sections = new Map();
        this._onChange = null;
    }

    /**
     * Registers the callback invoked with the bar's occupied height (0 while hidden) whenever it changes.
     * @param {function(height: number): void} callback
     * @returns {void}
     */
    onChange(callback) {
        this._onChange = callback;
    }

    /**
     * Sets (or replaces) the section owned by `id`; null clears it, hiding the bar at zero sections. No-op if unchanged.
     * @param {string} id
     * @param {StatusBarSection|null} section
     * @returns {void}
     */
    setSection(id, section) {
        const previous = this._sections.has(id) ? this._sections.get(id) : null;
        if (sectionsEqual(previous, section)) {
            return;
        }
        if (section === null) {
            this._sections.delete(id);
        } else {
            this._sections.set(id, section);
        }
        this._rebuild();
    }

    /**
     * @protected
     * @returns {boolean}
     */
    _hasContent() {
        return this._sections.size > 0;
    }

    /**
     * @protected
     * @param {number} height
     * @returns {void}
     */
    _onRebuilt(height) {
        if (this._onChange !== null) {
            this._onChange(height);
        }
    }

    /**
     * Builds the bar's content left to right and the background sized to fit it.
     * @protected
     * @returns {number} the bar's total height
     */
    _rebuildContent() {
        const insets = SafeArea.insets();
        const sections = [...this._sections.values()].sort((a, b) => a.order - b.order);
        const builtButtons = sections.flatMap(section => section.buttons)
            .map(button => buildPanelButton(this.textureRegistry, button.label, PANEL_BORDER, button.onClick));

        const width = this._app.screen.width;
        const contentTop = insets.top + FRAME_MARGIN;
        const contentRight = width - insets.right - FRAME_MARGIN;

        let x = insets.left + FRAME_MARGIN;
        for (const [i, built] of builtButtons.entries()) {
            if (i > 0) {
                x += BUTTON_GAP;
            }
            built.x = x;
            x += built.width;
        }
        let patternX = 0;
        if (builtButtons.length > 0) {
            patternX = x + PATTERN_GAP;
            x = patternX + THIN_PATTERN_WIDTH + PATTERN_GAP;
        }

        // The inset fills the rest of the bar, holding the text centered within itself; the text
        // wraps rather than overflowing the inset, growing the bar instead.
        const insetX = x;
        const insetWidth = Math.max(contentRight - insetX, 0);
        const textWidth = Math.max(insetWidth - TEXT_PADDING * 2, MIN_TEXT_WIDTH);
        const text = this._barText(sections.map(section => section.text).join(TEXT_GAP), textWidth);

        let rowHeight = text.height;
        for (const built of builtButtons) {
            rowHeight = Math.max(rowHeight, built.height);
        }

        for (const built of builtButtons) {
            built.y = contentTop + (rowHeight - built.height) / 2;
            this._addNode(built);
        }
        if (builtButtons.length > 0) {
            const pattern = UIPanel.patternStrip(this.textureRegistry, THIN_PATTERN_WIDTH, rowHeight);
            pattern.position.set(patternX, contentTop);
            this._addNode(pattern);
        }

        if (insetWidth > 0) {
            const inset = UIPanel.insetSprite(this.textureRegistry, insetWidth, rowHeight, PANEL_TINT);
            inset.position.set(insetX, contentTop);
            this._addNode(inset);
            text.x = insetX + Math.round((insetWidth - text.width) / 2);
        } else {
            text.x = Math.round((width - text.width) / 2);
        }
        text.y = contentTop + (rowHeight - text.height) / 2;
        this._addNode(text);

        const height = contentTop + rowHeight + FRAME_MARGIN;
        this._rebuildFrame(width, height, EDGE_BLEED);
        return height;
    }
}
