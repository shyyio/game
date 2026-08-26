import {CircleButtonLayer} from "@/client/hud/CircleButtonLayer.js";
import {drawMountainIcon} from "@/client/hud/icons.js";

/**
 * Always-visible top-right terrain-tuning button, immediately left of the art button.
 */
export class TerrainButtonLayer extends CircleButtonLayer {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super(app, drawMountainIcon);
    }

    /**
     * @protected
     * @returns {number}
     */
    _x() {
        return this._slotX(4);
    }
}
