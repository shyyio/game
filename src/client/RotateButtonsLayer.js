import {Container, Graphics, Text} from "pixi.js";
import Haptics from "@/client/Haptics.js";
import {GAME_FONT} from "@/client/constants.js";

const BUTTON_SIZE = 56;
const BUTTON_RADIUS = 8;
// Sits above the bottom-centered tool toolbar, anchored to the bottom-right.
const MARGIN_BOTTOM = 96;
const MARGIN_RIGHT = 24;

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
        this.visible = false;
        this.zIndex = 1000;

        this._button = this._createButton("↻", () => this._invoke(this._onRotate));
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
     * @private
     * @param {function(): void|null} callback
     */
    _invoke(callback) {
        if (callback != null) {
            callback();
        }
    }

    /**
     * Builds one square icon button with a hover highlight.
     * @private
     * @param {string} label
     * @param {function(): void} onPress
     * @returns {Container}
     */
    _createButton(label, onPress) {
        const button = new Container();
        button.eventMode = "static";
        button.cursor = "pointer";

        const bg = new Graphics();
        bg.roundRect(0, 0, BUTTON_SIZE, BUTTON_SIZE, BUTTON_RADIUS)
            .fill({color: 0x1a1a1a, alpha: 0.92})
            .stroke({color: 0x555555, width: 1});
        button.addChild(bg);

        // Lit on press for tap feedback, cleared on release.
        const pressBg = new Graphics();
        pressBg.roundRect(0, 0, BUTTON_SIZE, BUTTON_SIZE, BUTTON_RADIUS).fill({color: 0x5bb5ff});
        pressBg.alpha = 0;
        button.addChild(pressBg);

        const text = new Text({
            text: label,
            style: {fontFamily: GAME_FONT, fontSize: 30, fill: 0xffffff},
        });
        text.x = (BUTTON_SIZE - text.width) / 2;
        text.y = (BUTTON_SIZE - text.height) / 2;
        button.addChild(text);

        button.on("pointerdown", (e) => {
            // Keep the press on the button: it must not reach the viewport (pan) or
            // be read as a tap-to-place on the world beneath.
            e.nativeEvent.stopPropagation();
            pressBg.alpha = 0.5;
            Haptics.tap();
            onPress();
        });
        const release = () => { pressBg.alpha = 0; };
        button.on("pointerup", release);
        button.on("pointerupoutside", release);
        button.on("pointercancel", release);

        return button;
    }

    /**
     * Anchors the rotate button to the bottom-right of the screen.
     * @private
     */
    _layout() {
        // Anchor to the game area's right edge (the canvas may be inset from the
        // window's right), but the visible bottom is the full canvas height.
        this._button.x = this._viewport.screenWidth - MARGIN_RIGHT - BUTTON_SIZE;
        this._button.y = this._app.screen.height - MARGIN_BOTTOM - BUTTON_SIZE;
    }
}
