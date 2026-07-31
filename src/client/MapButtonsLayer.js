import {Container, Graphics} from "pixi.js";
import {HUD_BOTTOM_OFFSET, ViewMode} from "@/client/constants.js";
import {PANEL_BORDER, PANEL_TEXT, BLOCKED_TILE_COLOR} from "@/client/Theme.js";
import {ICON_STROKE} from "@/client/icons.js";
import {drawCircleButtonFace} from "@/client/pixiUtils.js";

const BUTTON_RADIUS = 24;
const BUTTON_GAP = 10;
const MARGIN = 16;
// Arm length of the close cross inside the active (red) circle.
const CROSS_ARM = 8;

/**
 * One entry in the map button stack: its display, icon painter, press action, and state.
 */
class MapButton {

    /**
     * @param {string} id
     * @param {function(Graphics): void} drawIcon - paints the idle icon around (0, 0)
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
        this.active = false;
        this.shown = true;
        this.hovered = false;
    }
}

/**
 * Contextual map-mode buttons: a bottom-right stack shown only zoomed out, one per input
 * mode. A press toggles the mode; active buttons show a red close cross. The host registers
 * the buttons and pushes their active/shown state.
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
     * @param {function(Graphics): void} drawIcon - paints the idle icon around (0, 0)
     * @param {function(): void} onPress
     * @returns {void}
     */
    addButton(id, drawIcon, onPress) {
        const container = new Container();
        const face = new Graphics();
        container.addChild(face);
        container.eventMode = "static";
        container.cursor = "pointer";
        const button = new MapButton(id, drawIcon, onPress, container, face);
        container.on("pointerdown", (e) => e.stopPropagation());
        container.on("pointertap", () => button.onPress());
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
     * @param {boolean} active
     * @returns {void}
     */
    setActive(id, active) {
        const button = this._require(id);
        if (button.active === active) {
            return;
        }
        button.active = active;
        this._render(button);
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
     * Idle: panel-background circle with the button's icon; active: red circle with a close cross.
     * @private
     * @param {MapButton} button
     * @returns {void}
     */
    _render(button) {
        const face = button.face;
        face.clear();
        if (button.active) {
            face
                .circle(0, 0, BUTTON_RADIUS)
                .fill({color: BLOCKED_TILE_COLOR})
                .stroke({color: PANEL_BORDER, width: 1});
            face
                .moveTo(-CROSS_ARM, -CROSS_ARM)
                .lineTo(CROSS_ARM, CROSS_ARM)
                .moveTo(CROSS_ARM, -CROSS_ARM)
                .lineTo(-CROSS_ARM, CROSS_ARM)
                .stroke({color: PANEL_TEXT, width: ICON_STROKE + 0.5, cap: "round"});
            return;
        }
        drawCircleButtonFace(face, BUTTON_RADIUS, button.hovered);
        button.drawIcon(face);
    }
}
