import {CircleButtonLayer} from "@/client/hud/CircleButtonLayer.js";
import {drawSettingsIcon} from "@/client/hud/icons.js";

/**
 * Always-visible top-right settings button.
 */
export class SettingsButtonLayer extends CircleButtonLayer {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super(app, drawSettingsIcon);
    }
}
