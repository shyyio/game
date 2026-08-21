import {CircleButtonLayer} from "@/client/hud/CircleButtonLayer.js";
import {drawBrushIcon} from "@/client/hud/icons.js";

/**
 * Always-visible top-right art (sprite editor) button, immediately left of the production button.
 */
export class ArtButtonLayer extends CircleButtonLayer {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super(app, drawBrushIcon);
    }

    /**
     * @protected
     * @returns {number}
     */
    _x() {
        return this._slotX(3);
    }
}
