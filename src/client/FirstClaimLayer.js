import {Container, Text} from "pixi.js";
import {GAME_FONT, ViewMode} from "@/client/constants.js";
import {PANEL_TEXT, PANEL_TINT} from "@/client/Theme.js";
import {UIPanel} from "@/client/UIPanel.js";

const MARGIN = 12;
const PADDING_X = 14;
const PADDING_Y = 10;
// Gap between the outer frame and the sunken inset body.
const FRAME_MARGIN = 6;

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
        this.textureRegistry = null;
        // Display-only: never a hit target (the stage is interactive for mobile pinch).
        this.eventMode = "none";
        this.zIndex = 9000;
        this.visible = false;
        this._noClaims = false;
        this._viewMode = ViewMode.WORLD;

        this._panel = new Container();
        this._frame = null;
        this._inset = null;
        this._text = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: 16, fill: PANEL_TEXT},
        });
        this._text.x = FRAME_MARGIN + PADDING_X;
        this._text.y = FRAME_MARGIN + PADDING_Y;
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
            this._rebuildBackground();
        }
        this._center();
    }

    /**
     * Rebuilds the background sized to the current text; a no-op until the texture
     * registry is assigned (claim sync can arrive before the client has loaded textures).
     * @private
     * @returns {void}
     */
    _rebuildBackground() {
        if (this.textureRegistry === null) {
            return;
        }
        const width = this._text.width + (PADDING_X + FRAME_MARGIN) * 2;
        const height = this._text.height + (PADDING_Y + FRAME_MARGIN) * 2;
        if (this._frame !== null) {
            this._frame.destroy();
            this._inset.destroy();
        }
        this._frame = UIPanel.frameSprite(this.textureRegistry, width, height, PANEL_TINT);
        this._inset = UIPanel.insetSprite(this.textureRegistry, width - FRAME_MARGIN * 2, height - FRAME_MARGIN * 2, PANEL_TINT);
        this._inset.position.set(FRAME_MARGIN, FRAME_MARGIN);
        this._panel.addChildAt(this._inset, 0);
        this._panel.addChildAt(this._frame, 0);
    }

    /**
     * Rebuilds the background for the current banner, once the texture registry becomes available
     * (the initial claim sync can set the banner before textures are loaded).
     * @returns {void}
     */
    refreshBackground() {
        if (this.textureRegistry !== null && this.visible) {
            this._rebuildBackground();
        }
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
