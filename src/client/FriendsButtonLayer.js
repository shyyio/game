import {CircleButtonLayer, CIRCLE_BUTTON_MARGIN, CIRCLE_BUTTON_RADIUS} from "@/client/CircleButtonLayer.js";
import {drawSmileyIcon} from "@/client/icons.js";

// Clears the settings button, sitting immediately to its left.
const BUTTON_GAP = 12;

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
        return this._app.screen.width - CIRCLE_BUTTON_MARGIN - CIRCLE_BUTTON_RADIUS - (2 * CIRCLE_BUTTON_RADIUS + BUTTON_GAP);
    }
}
