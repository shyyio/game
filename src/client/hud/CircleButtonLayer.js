import {Container, Graphics} from "pixi.js";
import {drawCircleButtonFace, trackTap} from "@/client/layers/pixiUtils.js";
import SafeArea from "@/client/SafeArea.js";

export const CIRCLE_BUTTON_RADIUS = 24;
export const CIRCLE_BUTTON_MARGIN = 16;
export const CIRCLE_BUTTON_GAP = 12;

/**
 * Always-visible circular icon button, screen-space on app.stage; subclass draws its own icon.
 */
export class CircleButtonLayer extends Container {

    /**
     * @param {Application} app
     * @param {function(Graphics): void} drawIcon
     */
    constructor(app, drawIcon) {
        super();
        this._app = app;
        this._drawIcon = drawIcon;
        this.zIndex = 9500;
        this._topOffset = 0;
        this._hovered = false;
        this._onPress = null;

        this.cursor = "pointer";
        this._face = new Graphics();
        this.addChild(this._face);
        // suppressTouchGhostClick: avoids the dialog's click-outside directive seeing the ghost click.
        trackTap(this, () => {
            if (this._onPress !== null) {
                this._onPress();
            }
        }, {suppressTouchGhostClick: true});
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
     * @returns {number} the button circle's bottom edge, for anchoring things below it
     */
    get bottomY() {
        return this.y + CIRCLE_BUTTON_RADIUS;
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
     * This button's x position; the default sits alone in the top-right corner.
     * @protected
     * @returns {number}
     */
    _x() {
        return this._slotX(0);
    }

    /**
     * X position of the nth button slot from the top-right corner.
     * @protected
     * @param {number} slot
     * @returns {number}
     */
    _slotX(slot) {
        return this._app.screen.width - SafeArea.insets().right - CIRCLE_BUTTON_MARGIN - CIRCLE_BUTTON_RADIUS
            - slot * (2 * CIRCLE_BUTTON_RADIUS + CIRCLE_BUTTON_GAP);
    }

    /**
     * @private
     * @returns {void}
     */
    _render() {
        const face = this._face;
        face.clear();
        drawCircleButtonFace(face, CIRCLE_BUTTON_RADIUS, this._hovered);
        this._drawIcon(face);
    }

    /**
     * @private
     * @returns {void}
     */
    _layout() {
        this.x = this._x();
        this.y = CIRCLE_BUTTON_MARGIN + CIRCLE_BUTTON_RADIUS + this._topOffset;
    }
}
