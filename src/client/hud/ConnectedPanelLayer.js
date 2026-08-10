import {Container} from "pixi.js";
import {PanelConnectorController} from "@/client/hud/PanelConnectorController.js";

/**
 * Base for a HUD panel layer whose panel(s) are linked to a world tile by a {@link PanelConnectorController} curve.
 */
export class ConnectedPanelLayer extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this._app = app;
        this._viewport = null;
        this._connectors = new PanelConnectorController(app);
        this.addChild(this._connectors.graphics);
    }

    /**
     * The game viewport, for mapping a panel's target tile to the screen (set by the host).
     * @returns {ClientViewport|null}
     */
    get viewport() {
        return this._viewport;
    }

    /**
     * @param {ClientViewport} value
     */
    set viewport(value) {
        this._viewport = value;
        this._connectors.viewport = value;
    }
}
