import {CircleButtonLayer} from "@/client/hud/CircleButtonLayer.js";
import {drawSmileyIcon} from "@/client/hud/icons.js";

/**
 * Always-visible top-right friends button, immediately left of the settings button.
 */
export class FriendsButtonLayer extends CircleButtonLayer {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super(app, drawSmileyIcon);
    }

    /**
     * @protected
     * @returns {number}
     */
    _x() {
        return this._slotX(1);
    }
}
