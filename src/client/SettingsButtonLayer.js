import {Container, Graphics} from "pixi.js";
import {drawSettingsIcon} from "@/client/icons.js";
import {drawCircleButtonFace} from "@/client/pixiUtils.js";

const RADIUS = 24;
const MARGIN = 16;

/**
 * Always-visible top-right settings button: a single circular icon button, screen-space on
 * app.stage. Sits clear of the top status bar via {@link SettingsButtonLayer#setTopOffset},
 * driven by the bar's own occupied height.
 */
export class SettingsButtonLayer extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this._app = app;
        this.zIndex = 9500;
        this._topOffset = 0;
        this._hovered = false;
        this._onPress = null;

        this.eventMode = "static";
        this.cursor = "pointer";
        this._face = new Graphics();
        this.addChild(this._face);
        this.on("pointerdown", (e) => e.stopPropagation());
        this.on("pointertap", () => {
            if (this._onPress !== null) {
                this._onPress();
            }
        });
        this.on("pointerover", () => {
            this._hovered = true;
            this._render();
        });
        this.on("pointerout", () => {
            this._hovered = false;
            this._render();
        });

        this._render();
        this._layout();
        app.renderer.on("resize", () => this._layout());
    }

    /**
     * @param {function(): void} callback
     * @returns {void}
     */
    onPress(callback) {
        this._onPress = callback;
    }

    /**
     * Shifts the button down by `offset` px, clearing whatever currently occupies the top edge.
     * @param {number} offset
     * @returns {void}
     */
    setTopOffset(offset) {
        if (offset === this._topOffset) {
            return;
        }
        this._topOffset = offset;
        this._layout();
    }

    /**
     * @private
     * @returns {void}
     */
    _render() {
        const face = this._face;
        face.clear();
        drawCircleButtonFace(face, RADIUS, this._hovered);
        drawSettingsIcon(face);
    }

    /**
     * @private
     * @returns {void}
     */
    _layout() {
        this.x = this._app.screen.width - MARGIN - RADIUS;
        this.y = MARGIN + RADIUS + this._topOffset;
    }
}
