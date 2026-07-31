import {Container, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_TINT, PANEL_BORDER, TOOLBAR_TEXT} from "@/client/Theme.js";
import {UIPanel} from "@/client/UIPanel.js";
import {buildPanelButton} from "@/client/panelButton.js";

// Gap between the outer frame and its content (buttons, pattern, inset), matching the inspect
// panel's body margin.
const FRAME_MARGIN = 6;
// Gap between adjacent floating buttons.
const BUTTON_GAP = 8;
// Gap between joined section texts, when more than one section is active at once.
const TEXT_GAP = "   ";
// Width of the decorative pattern strip flanking the buttons; deliberately thin.
const THIN_PATTERN_WIDTH = 14;
// Gap around each decorative pattern strip.
const PATTERN_GAP = 10;
// How far the frame sprite bleeds past the left/top/right edges, past its border's on-screen
// thickness, so only the bottom border reads — the bar already spans edge to edge on the others.
const EDGE_BLEED = 24;

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
 * One caller's contribution to the top status bar: a text line and its buttons. Callers (core
 * systems or mods) own their section by id, set through {@link TopStatusBarLayer#setSection};
 * setting the same id again replaces their content without touching anyone else's.
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
 * Full-width status bar docked to the top of the screen, laid out left to right: every section's
 * buttons, a thin decorative pattern, then an inset holding the joined section text centered
 * within itself. Each section is independently owned by id — core systems (e.g. claim mode) and
 * mods set or clear their own section without touching anyone else's. Hidden with zero sections.
 * A screen-space HUD on app.stage, so it never pans or zooms with the world.
 */
export class TopStatusBarLayer extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this._app = app;
        this.textureRegistry = null;
        this.zIndex = 9000;
        this.visible = false;
        /** @type {Map<string, StatusBarSection>} */
        this._sections = new Map();
        /** @type {Container[]} */
        this._sectionNodes = [];

        this._panel = new Container();
        this._panel.x = 0;
        this._panel.y = 0;
        // Presses on the bar must not fall through to the viewport (pan/tap).
        this._panel.eventMode = "static";
        this._panel.on("pointerdown", (e) => e.stopPropagation());
        this._frame = null;
        this._onChange = null;
        this.addChild(this._panel);
        app.renderer.on("resize", () => this._rebuild());
    }

    /**
     * Registers the callback invoked with the bar's occupied height (0 while hidden) whenever it
     * changes; other top-anchored HUD elements use this to stay clear of the bar.
     * @param {function(height: number): void} callback
     * @returns {void}
     */
    onChange(callback) {
        this._onChange = callback;
    }

    /**
     * Sets (or replaces) the section owned by `id`; null clears it. The bar shows whenever at
     * least one section is set, hides at zero. A no-op if the section is unchanged, so callers
     * can safely call this every frame.
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
     * Rebuilds for the current sections once the texture registry becomes available (a section
     * can be set before the client has loaded textures).
     * @returns {void}
     */
    refreshBackground() {
        this._rebuild();
    }

    /**
     * @private
     * @returns {void}
     */
    _rebuild() {
        this.visible = this._sections.size > 0;
        for (const node of this._sectionNodes) {
            node.destroy({children: true});
        }
        this._sectionNodes = [];

        let height = 0;
        if (this.visible && this.textureRegistry !== null) {
            height = this._rebuildContent();
        }
        if (this._onChange !== null) {
            this._onChange(this.visible ? height : 0);
        }
    }

    /**
     * Builds the bar's content left to right — buttons, a thin pattern, then an inset holding
     * the centered text — and the background sized to fit it.
     * @private
     * @returns {number} the bar's total height
     */
    _rebuildContent() {
        const sections = [...this._sections.values()].sort((a, b) => a.order - b.order);
        const builtButtons = sections.flatMap(section => section.buttons)
            .map(button => buildPanelButton(this.textureRegistry, button.label, PANEL_BORDER, button.onClick));
        const text = new Text({
            text: sections.map(section => section.text).join(TEXT_GAP),
            style: {fontFamily: GAME_FONT, fontSize: 20, fill: TOOLBAR_TEXT},
        });

        let rowHeight = text.height;
        for (const built of builtButtons) {
            rowHeight = Math.max(rowHeight, built.height);
        }
        const width = this._app.screen.width;
        const contentTop = FRAME_MARGIN;

        let x = FRAME_MARGIN;
        if (builtButtons.length > 0) {
            for (const [i, built] of builtButtons.entries()) {
                if (i > 0) {
                    x += BUTTON_GAP;
                }
                built.x = x;
                built.y = contentTop + (rowHeight - built.height) / 2;
                this._panel.addChild(built);
                this._sectionNodes.push(built);
                x += built.width;
            }
            x += PATTERN_GAP;
            x = this._addPattern(x, contentTop, rowHeight);
        }

        // The inset fills the rest of the bar, holding the text centered within itself.
        const insetX = x;
        const insetWidth = Math.max(width - FRAME_MARGIN - insetX, 0);
        if (insetWidth > 0) {
            const inset = UIPanel.insetSprite(this.textureRegistry, insetWidth, rowHeight, PANEL_TINT);
            inset.position.set(insetX, contentTop);
            this._panel.addChild(inset);
            this._sectionNodes.push(inset);
            text.x = insetX + Math.round((insetWidth - text.width) / 2);
        } else {
            text.x = Math.round((width - text.width) / 2);
        }
        text.y = contentTop + (rowHeight - text.height) / 2;
        this._panel.addChild(text);
        this._sectionNodes.push(text);

        const height = rowHeight + FRAME_MARGIN * 2;
        this._rebuildBackground(width, height);
        return height;
    }

    /**
     * Adds a very thin decorative pattern strip at `x`, tracked for the next rebuild's teardown.
     * @private
     * @param {number} x
     * @param {number} y
     * @param {number} height
     * @returns {number} x past the strip and its trailing gap
     */
    _addPattern(x, y, height) {
        const pattern = UIPanel.patternStrip(this.textureRegistry, THIN_PATTERN_WIDTH, height);
        pattern.position.set(x, y);
        this._panel.addChild(pattern);
        this._sectionNodes.push(pattern);
        return x + THIN_PATTERN_WIDTH + PATTERN_GAP;
    }

    /**
     * @private
     * @param {number} width
     * @param {number} height
     * @returns {void}
     */
    _rebuildBackground(width, height) {
        if (this._frame !== null) {
            this._frame.destroy();
        }
        this._frame = UIPanel.frameSprite(this.textureRegistry, width + EDGE_BLEED * 2, height + EDGE_BLEED, PANEL_TINT);
        this._frame.position.set(-EDGE_BLEED, -EDGE_BLEED);
        this._panel.addChildAt(this._frame, 0);
    }
}
