import {Container, Graphics, Text} from "pixi.js";
import {GAME_FONT, ViewMode} from "@/client/constants.js";
import {PANEL_TEXT} from "@/client/Theme.js";
import {drawPanelBackground} from "@/client/icons.js";

const MARGIN = 12;
const PADDING_X = 14;
const PADDING_Y = 10;

const WORLD_MESSAGE = "No claimed chunks yet — zoom out to the map to claim your first one";
const MAP_MESSAGE = "Select an unclaimed chunk and press Claim chunk";

/**
 * Top-center onboarding banner guiding a player with zero claims to their first chunk. A
 * screen-space HUD on app.stage; the host drives it from the claim sync/update events.
 */
export class FirstClaimLayer extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this._app = app;
        // Display-only: never a hit target (the stage is interactive for mobile pinch).
        this.eventMode = "none";
        this.zIndex = 9000;
        this.visible = false;
        this._noClaims = false;
        this._viewMode = ViewMode.WORLD;

        this._panel = new Container();
        this._background = new Graphics();
        this._text = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: 16, fill: PANEL_TEXT},
        });
        this._text.x = PADDING_X;
        this._text.y = PADDING_Y;
        this._panel.addChild(this._background);
        this._panel.addChild(this._text);
        this.addChild(this._panel);
        app.renderer.on("resize", () => this._center());
    }

    /**
     * Shows or hides the banner as the own player's claim count crosses zero.
     * @param {boolean} noClaims
     * @returns {void}
     */
    setNoClaims(noClaims) {
        this._noClaims = noClaims;
        this._refresh();
    }

    /**
     * @param {ViewMode} mode
     * @returns {void}
     */
    setViewMode(mode) {
        this._viewMode = mode;
        this._refresh();
    }

    /**
     * @private
     * @returns {void}
     */
    _refresh() {
        this.visible = this._noClaims;
        if (!this.visible) {
            return;
        }
        let message;
        if (this._viewMode === ViewMode.WORLD) {
            message = WORLD_MESSAGE;
        } else {
            message = MAP_MESSAGE;
        }
        if (message !== this._text.text) {
            this._text.text = message;
            this._background.clear();
            drawPanelBackground(this._background, this._text.width + PADDING_X * 2, this._text.height + PADDING_Y * 2);
        }
        this._center();
    }

    /**
     * @private
     * @returns {void}
     */
    _center() {
        this._panel.x = Math.round((this._app.screen.width - this._panel.width) / 2);
        this._panel.y = MARGIN;
    }
}
