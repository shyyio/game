import {Container, Graphics} from "pixi.js";
import {HUD_BOTTOM_OFFSET, ViewMode} from "@/client/constants.js";
import {drawCircleButtonFace, trackTap} from "@/client/layers/pixiUtils.js";

const BUTTON_RADIUS = 24;
const BUTTON_GAP = 10;
const MARGIN = 16;

/**
 * One entry in the map button stack: its display, icon painter, press action, and state.
 */
class MapButton {

    /**
     * @param {string} id
     * @param {function(Graphics): void} drawIcon - paints the icon around (0, 0)
     * @param {function(): void} onPress
     * @param {Container} container
     * @param {Graphics} face
     */
    constructor(id, drawIcon, onPress, container, face) {
        this.id = id;
        this.drawIcon = drawIcon;
        this.onPress = onPress;
        this.container = container;
        this.face = face;
        this.shown = true;
        this.hovered = false;
    }
}

/**
 * Contextual map-mode buttons: bottom-right stack, zoomed-out only, each a one-shot action or
 * a mode entry (the mode's own bars take over once inside).
 */
export class MapButtonsLayer extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this._app = app;
        this.zIndex = 900;
        this.visible = false;
        this._zoomedOut = false;
        /**
         * @type {MapButton[]}
         */
        this._buttons = [];
        app.renderer.on("resize", () => this._layout());
    }

    /**
     * Registers a button; order in the stack follows registration order, bottom-up.
     * @param {string} id
     * @param {function(Graphics): void} drawIcon - paints the icon around (0, 0)
     * @param {function(): void} onPress
     * @returns {void}
     */
    addButton(id, drawIcon, onPress) {
        const container = new Container();
        const face = new Graphics();
        container.addChild(face);
        container.cursor = "pointer";
        const button = new MapButton(id, drawIcon, onPress, container, face);
        trackTap(container, () => button.onPress());
        container.on("pointerover", () => {
            button.hovered = true;
            this._render(button);
        });
        container.on("pointerout", () => {
            button.hovered = false;
            this._render(button);
        });
        this._buttons.push(button);
        this.addChild(container);
        this._render(button);
        this._refresh();
    }

    /**
     * @param {string} id
     * @param {boolean} shown
     * @returns {void}
     */
    setButtonVisible(id, shown) {
        const button = this._require(id);
        if (button.shown === shown) {
            return;
        }
        button.shown = shown;
        this._refresh();
    }

    /**
     * Shown zoomed out (map and overworld) only.
     * @param {ViewMode} mode
     * @returns {void}
     */
    setViewMode(mode) {
        this._zoomedOut = mode !== ViewMode.WORLD;
        this._refresh();
    }

    /**
     * @private
     * @param {string} id
     * @returns {MapButton}
     */
    _require(id) {
        const button = this._buttons.find(b => b.id === id);
        if (button === undefined) {
            throw new RangeError(`Unknown map button: ${id}`);
        }
        return button;
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        for (const button of this._buttons) {
            this._render(button);
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _refresh() {
        for (const button of this._buttons) {
            button.container.visible = button.shown;
        }
        this.visible = this._zoomedOut && this._buttons.some(b => b.shown);
        this._layout();
    }

    /**
     * Bottom-right stack, growing upward.
     * @private
     * @returns {void}
     */
    _layout() {
        const x = this._app.screen.width - MARGIN - BUTTON_RADIUS;
        let y = this._app.screen.height - HUD_BOTTOM_OFFSET - BUTTON_RADIUS;
        for (const button of this._buttons) {
            if (!button.shown) {
                continue;
            }
            button.container.x = x;
            button.container.y = y;
            y -= BUTTON_RADIUS * 2 + BUTTON_GAP;
        }
    }

    /**
     * Panel-background circle with the button's icon.
     * @private
     * @param {MapButton} button
     * @returns {void}
     */
    _render(button) {
        const face = button.face;
        face.clear();
        drawCircleButtonFace(face, BUTTON_RADIUS, button.hovered);
        button.drawIcon(face);
    }
}
