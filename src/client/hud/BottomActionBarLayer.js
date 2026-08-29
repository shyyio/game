import {CONFIRM_HOTKEY} from "@/client/constants.js";
import {PANEL_TINT, ACTIVE_ACCENT} from "@/client/Theme.js";
import {FRAME_MARGIN, UIPanel} from "@/client/hud/UIPanel.js";
import {buildPanelButton, hotkeyLabel} from "@/client/hud/panelButton.js";
import {
    AbstractEdgeBarLayer,
    MIN_TEXT_WIDTH,
    PATTERN_GAP,
    TEXT_PADDING,
    THIN_PATTERN_WIDTH,
} from "@/client/hud/AbstractEdgeBarLayer.js";
import SafeArea from "@/client/SafeArea.js";

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
export class BottomActionBarLayer extends AbstractEdgeBarLayer {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super(app);
        /** @type {BottomBarAction|null} */
        this._action = null;
    }

    /**
     * Sets the forward action; null clears and hides the bar. No-op if unchanged.
     * @param {BottomBarAction|null} action
     * @returns {void}
     */
    set(action) {
        const previousText = this._action === null ? null : this._action.text;
        const text = action === null ? null : action.text;
        // Same display, fresher handler: swap without a rebuild.
        this._action = action;
        if (previousText === text) {
            return;
        }
        this._rebuild();
    }

    /**
     * Fires the current action's Confirm (the keybind's path); a no-op while hidden.
     * @returns {void}
     */
    pressConfirm() {
        if (this._action !== null && this.visible) {
            this._action.onConfirm();
        }
    }

    /**
     * @protected
     * @returns {boolean}
     */
    _hasContent() {
        return this._action !== null;
    }

    /**
     * Builds the bar's content — text inset left, pattern, Confirm rightmost — and the
     * background sized to fit it.
     * @protected
     * @returns {number} the bar's total height
     */
    _rebuildContent() {
        const insets = SafeArea.insets();
        const width = this._app.screen.width;
        const contentTop = FRAME_MARGIN;
        const contentRight = width - insets.right - FRAME_MARGIN;

        const button = buildPanelButton(this.textureRegistry, hotkeyLabel("Confirm", CONFIRM_HOTKEY),
            ACTIVE_ACCENT, () => this._action.onConfirm());
        button.x = contentRight - button.width;

        const patternX = button.x - PATTERN_GAP - THIN_PATTERN_WIDTH;
        const insetX = insets.left + FRAME_MARGIN;
        const insetWidth = Math.max(patternX - PATTERN_GAP - insetX, 0);
        const textWidth = Math.max(insetWidth - TEXT_PADDING * 2, MIN_TEXT_WIDTH);
        const text = this._barText(this._action.text, textWidth);

        const rowHeight = Math.max(text.height, button.height);
        button.y = contentTop + (rowHeight - button.height) / 2;
        this._addNode(button);

        const pattern = UIPanel.patternStrip(this.textureRegistry, THIN_PATTERN_WIDTH, rowHeight);
        pattern.position.set(patternX, contentTop);
        this._addNode(pattern);

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

        const height = contentTop + rowHeight + FRAME_MARGIN + insets.bottom;
        // The frame's border reads on the bar's top edge, so it bleeds off the other three.
        this._rebuildFrame(width, height, 0);
        this._panel.y = this._app.screen.height - height;
        return height;
    }
}
