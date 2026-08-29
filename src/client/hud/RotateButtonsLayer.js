import {Container, Graphics, Text} from "pixi.js";
import Haptics from "@/client/Haptics.js";
import {GAME_FONT, HUD_BOTTOM_OFFSET} from "@/client/constants.js";
import {PANEL_TEXT} from "@/client/Theme.js";
import {centerGlyph, drawCircleButtonFace, trackTap} from "@/client/layers/pixiUtils.js";
import {HudLayer} from "@/client/hud/HudLayer.js";

const BUTTON_RADIUS = 24;
const MARGIN_RIGHT = 16;
const ICON_SIZE = 28;

/**
 * On-screen pixi button that rotates the active tool clockwise, toggled with the tool selection.
 */
export class RotateButtonsLayer extends Container {

    /**
     * @param {Application} app - the canvas/stage this button lives in (screen space)
     * @param {ClientViewport} viewport - the game area; its screen width anchors the
     *     button, since the canvas can be inset from the right edge of the window
     */
    constructor(app, viewport) {
        super();
        this._app = app;
        this._viewport = viewport;
        this._onRotate = null;
        this._hovered = false;
        // Set by _createButton; restyle re-applies its fill.
        this._icon = null;
        this.visible = false;
        this.zIndex = HudLayer.ROTATE_CONTROL;

        this._button = this._createButton();
        this.addChild(this._button);

        // Re-anchor every frame so the button tracks the game area through window
        // resizes and changes to the canvas inset (which don't fire a renderer resize).
        this._layout();
        this._app.ticker.add(() => this._layout());
    }

    /**
     * Registers the click callback for the rotate (clockwise) button.
     * @param {function(): void} rotate
     */
    onRotate(rotate) {
        this._onRotate = rotate;
    }

    /**
     * @param {boolean} visible
     */
    setVisible(visible) {
        this.visible = visible;
    }

    /**
     * Toggles hit-testing of the buttons, off mid-drag so a pan crossing one isn't captured.
     * @param {boolean} enabled
     */
    setInteractive(enabled) {
        this.interactiveChildren = enabled;
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        this._icon.style.fill = PANEL_TEXT;
        this._render();
    }

    /**
     * Builds the circular button with a hover highlight, matching the map buttons.
     * @private
     * @returns {Container}
     */
    _createButton() {
        const button = new Container();
        button.cursor = "pointer";
        this._face = new Graphics();
        button.addChild(this._face);
        this._icon = new Text({
            text: "↻",
            style: {fontFamily: GAME_FONT, fontSize: ICON_SIZE, fontWeight: "bold", fill: PANEL_TEXT},
        });
        centerGlyph(this._icon);
        button.addChild(this._icon);
        // stopNativePropagation: the press must not reach the viewport (pan) or be read as a
        // tap-to-place on the world beneath.
        trackTap(button, () => {
            Haptics.tap();
            this._invoke(this._onRotate);
        }, {stopNativePropagation: true});
        button.on("pointerover", () => {
            this._hovered = true;
            this._render();
        });
        button.on("pointerout", () => {
            this._hovered = false;
            this._render();
        });
        this._render();
        return button;
    }

    /**
     * @private
     * @param {function(): void|null} callback
     */
    _invoke(callback) {
        if (callback != null) {
            callback();
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _render() {
        this._face.clear();
        drawCircleButtonFace(this._face, BUTTON_RADIUS, this._hovered);
    }

    /**
     * Anchors the rotate button to the bottom-right, above the toolbar (the map buttons' spot,
     * which is free whenever a tool is active).
     * @private
     */
    _layout() {
        this._button.x = this._viewport.screenWidth - MARGIN_RIGHT - BUTTON_RADIUS;
        this._button.y = this._app.screen.height - HUD_BOTTOM_OFFSET - BUTTON_RADIUS;
    }
}
