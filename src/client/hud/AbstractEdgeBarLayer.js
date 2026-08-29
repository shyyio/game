import {Container, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_TINT, PANEL_TINT_TEXT} from "@/client/Theme.js";
import {UIPanel} from "@/client/hud/UIPanel.js";
import {swallowClicks} from "@/client/layers/pixiUtils.js";
import {NotImplementedError} from "@/common/error.js";
import {HudLayer} from "@/client/hud/HudLayer.js";

// Width of the decorative pattern strip flanking the buttons; deliberately thin.
export const THIN_PATTERN_WIDTH = 14;
// Gap around each decorative pattern strip.
export const PATTERN_GAP = 10;
// How far the frame sprite bleeds past the screen edges, so only the inner border reads.
export const EDGE_BLEED = 24;
// Gap between the text and its inset's edges, kept clear of the wrap width.
export const TEXT_PADDING = 8;
// Wrap width floor, so a narrow screen wraps hard instead of collapsing to nothing.
export const MIN_TEXT_WIDTH = 80;
// Both bars read at the same size.
const BAR_FONT_SIZE = 20;

/**
 * A full-width bar docked to a screen edge: the frame, inset, pattern and wrapping text every bar
 * shares. Subclasses decide when they have content and lay it out (docs/ux-conventions.md puts
 * Back leftmost in the top bar, Confirm rightmost in the bottom one).
 */
export class AbstractEdgeBarLayer extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this._app = app;
        this.textureRegistry = null;
        this.zIndex = HudLayer.EDGE_BAR;
        this.visible = false;
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
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        this._rebuild();
    }

    /**
     * Rebuilds for the current content once the texture registry becomes available (content can
     * be set before the client has loaded textures).
     * @returns {void}
     */
    refreshBackground() {
        this._rebuild();
    }

    /**
     * Whether the bar has anything to show.
     * @protected
     * @returns {boolean}
     */
    _hasContent() {
        throw new NotImplementedError();
    }

    /**
     * Builds the bar's content and the background sized to fit it.
     * @protected
     * @returns {number} the bar's total height
     */
    _rebuildContent() {
        throw new NotImplementedError();
    }

    /**
     * Called after every rebuild with the bar's occupied height (0 while hidden).
     * @protected
     * @param {number} height
     * @returns {void}
     */
    _onRebuilt(height) {
    }

    /**
     * Drops the previous content and rebuilds it for the current state.
     * @protected
     * @returns {void}
     */
    _rebuild() {
        this.visible = this._hasContent();
        for (const node of this._contentNodes) {
            node.destroy({children: true});
        }
        this._contentNodes = [];

        let height = 0;
        if (this.visible && this.textureRegistry !== null) {
            height = this._rebuildContent();
        }
        this._onRebuilt(this.visible ? height : 0);
    }

    /**
     * Adds a content node, dropped by the next rebuild.
     * @protected
     * @param {Container} node
     * @returns {void}
     */
    _addNode(node) {
        this._panel.addChild(node);
        this._contentNodes.push(node);
    }

    /**
     * The bar's text: centered, wrapping within `wrapWidth` rather than overflowing.
     * @protected
     * @param {string} content
     * @param {number} wrapWidth
     * @returns {Text}
     */
    _barText(content, wrapWidth) {
        return new Text({
            text: content,
            style: {
                fontFamily: GAME_FONT,
                fontSize: BAR_FONT_SIZE,
                fill: PANEL_TINT_TEXT,
                align: "center",
                wordWrap: true,
                wordWrapWidth: wrapWidth,
                breakWords: true,
            },
        });
    }

    /**
     * Rebuilds the frame behind the content, bleeding past every edge but the one the bar's
     * border reads on.
     * @protected
     * @param {number} width
     * @param {number} height
     * @param {number} bleedTop - EDGE_BLEED for a top-docked bar, 0 for a bottom-docked one
     * @returns {void}
     */
    _rebuildFrame(width, height, bleedTop) {
        this._frame = UIPanel.rebuildFrame(this._panel, this._frame, this.textureRegistry,
            width + EDGE_BLEED * 2, height + EDGE_BLEED, PANEL_TINT, {x: -EDGE_BLEED, y: -bleedTop});
    }
}
