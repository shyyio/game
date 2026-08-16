import {Container, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_TINT, PANEL_TINT_TEXT, ACTIVE_ACCENT} from "@/client/Theme.js";
import {UIPanel} from "@/client/hud/UIPanel.js";
import {buildPanelButton} from "@/client/hud/panelButton.js";
import {swallowClicks} from "@/client/layers/pixiUtils.js";
import SafeArea from "@/client/SafeArea.js";
import Mobile from "@/client/Mobile.js";

// Gap between the outer frame and its content, matching the top status bar.
const FRAME_MARGIN = 6;
// Width of the decorative pattern strip between the text and the button.
const THIN_PATTERN_WIDTH = 14;
// Gap around the decorative pattern strip.
const PATTERN_GAP = 10;
// How far the frame sprite bleeds past the left/bottom/right edges, so only the top border reads.
const EDGE_BLEED = 24;
// Gap between the text and its inset's edges, kept clear of the wrap width.
const TEXT_PADDING = 8;
// Wrap width floor, so a narrow screen wraps hard instead of collapsing to nothing.
const MIN_TEXT_WIDTH = 80;

/**
 * The one forward label (docs/ux-conventions.md), with its Enter hint on desktop.
 * @returns {string}
 */
function confirmLabel() {
    return Mobile.enabled ? "Confirm" : "Confirm [Enter]";
}

/**
 * One mode's forward action: the bar's text and the Confirm handler.
 */
export class BottomBarAction {

    /**
     * @param {string} text
     * @param {function(): void} onConfirm
     */
    constructor(text, onConfirm) {
        this.text = text;
        this.onConfirm = onConfirm;
    }
}

/**
 * Full-width bar docked to the screen bottom: the active mode's forward action — its text and
 * the Confirm button, rightmost (docs/ux-conventions.md). Hidden without an action.
 */
export class BottomActionBarLayer extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this._app = app;
        this.textureRegistry = null;
        this.zIndex = 9000;
        this.visible = false;
        /** @type {BottomBarAction|null} */
        this._action = null;
        this._panel = new Container();
        // Presses on the bar must not fall through to the viewport (pan/tap).
        swallowClicks(this._panel);
        this._frame = null;
        /** @type {Container[]} */
        this._contentNodes = [];
        this.addChild(this._panel);
        app.renderer.on("resize", () => this._rebuild());
    }

    /**
     * Sets the forward action; null clears and hides the bar. No-op if unchanged.
     * @param {BottomBarAction|null} action
     * @returns {void}
     */
    set(action) {
        const previous = this._action;
        if (previous === action) {
            return;
        }
        if (previous !== null && action !== null && previous.text === action.text) {
            // Same display, fresher handler: swap without a rebuild.
            this._action = action;
            return;
        }
        this._action = action;
        this._rebuild();
    }

    /**
     * Fires the current action's Confirm (the Enter keybind's path); a no-op while hidden.
     * @returns {void}
     */
    pressConfirm() {
        if (this._action !== null && this.visible) {
            this._action.onConfirm();
        }
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        this._rebuild();
    }

    /**
     * Rebuilds for the current action once the texture registry becomes available.
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
        this.visible = this._action !== null;
        for (const node of this._contentNodes) {
            node.destroy({children: true});
        }
        this._contentNodes = [];

        if (this.visible && this.textureRegistry !== null) {
            this._rebuildContent();
        }
    }

    /**
     * Builds the bar's content — text inset left, pattern, Confirm rightmost — and the
     * background sized to fit it.
     * @private
     * @returns {void}
     */
    _rebuildContent() {
        const insets = SafeArea.insets();
        const width = this._app.screen.width;
        const contentTop = FRAME_MARGIN;
        const contentRight = width - insets.right - FRAME_MARGIN;

        const button = buildPanelButton(this.textureRegistry, confirmLabel(), ACTIVE_ACCENT,
            () => this._action.onConfirm());
        button.x = contentRight - button.width;

        const patternX = button.x - PATTERN_GAP - THIN_PATTERN_WIDTH;
        const insetX = insets.left + FRAME_MARGIN;
        const insetWidth = Math.max(patternX - PATTERN_GAP - insetX, 0);
        const textWidth = Math.max(insetWidth - TEXT_PADDING * 2, MIN_TEXT_WIDTH);
        const text = new Text({
            text: this._action.text,
            style: {
                fontFamily: GAME_FONT,
                fontSize: 20,
                fill: PANEL_TINT_TEXT,
                align: "center",
                wordWrap: true,
                wordWrapWidth: textWidth,
                breakWords: true,
            },
        });

        const rowHeight = Math.max(text.height, button.height);
        button.y = contentTop + (rowHeight - button.height) / 2;
        this._panel.addChild(button);
        this._contentNodes.push(button);

        const pattern = UIPanel.patternStrip(this.textureRegistry, THIN_PATTERN_WIDTH, rowHeight);
        pattern.position.set(patternX, contentTop);
        this._panel.addChild(pattern);
        this._contentNodes.push(pattern);

        if (insetWidth > 0) {
            const inset = UIPanel.insetSprite(this.textureRegistry, insetWidth, rowHeight, PANEL_TINT);
            inset.position.set(insetX, contentTop);
            this._panel.addChild(inset);
            this._contentNodes.push(inset);
            text.x = insetX + Math.round((insetWidth - text.width) / 2);
        } else {
            text.x = Math.round((width - text.width) / 2);
        }
        text.y = contentTop + (rowHeight - text.height) / 2;
        this._panel.addChild(text);
        this._contentNodes.push(text);

        const height = contentTop + rowHeight + FRAME_MARGIN + insets.bottom;
        this._rebuildBackground(width, height);
        this._panel.y = this._app.screen.height - height;
    }

    /**
     * @private
     * @param {number} width
     * @param {number} height
     * @returns {void}
     */
    _rebuildBackground(width, height) {
        this._frame = UIPanel.rebuildFrame(this._panel, this._frame, this.textureRegistry,
            width + EDGE_BLEED * 2, height + EDGE_BLEED, PANEL_TINT, {x: -EDGE_BLEED, y: 0});
    }
}
