import {CircleButtonLayer} from "@/client/hud/CircleButtonLayer.js";
import {drawChartIcon} from "@/client/hud/icons.js";

/**
 * Always-visible top-right production button, immediately left of the friends button.
 */
export class ProductionButtonLayer extends CircleButtonLayer {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super(app, drawChartIcon);
    }

    /**
     * @protected
     * @returns {number}
     */
    _x() {
        return this._slotX(2);
    }
}
