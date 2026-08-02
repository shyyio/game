import {Container, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_TEXT, PANEL_TINT} from "@/client/Theme.js";
import {UIPanel} from "@/client/UIPanel.js";

const MARGIN = 24;
const PADDING_X = 16;
const PADDING_Y = 12;
// Gap between the outer frame and the sunken inset body.
const FRAME_MARGIN = 6;

// How long a notice stays up; a new notify() call restarts this from the current message.
const NOTICE_DURATION_MS = 3000;

/**
 * Bottom-center toast notice (claim rejections, session disconnects). A screen-space HUD on
 * app.stage; the host drives it by calling {@link NoticeLayer#notify}.
 */
export class NoticeLayer extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this._app = app;
        this._textureRegistry = null;
        // A notify() before textureRegistry is assigned (e.g. the session closes while Client.init's
        // texture load is still in flight) can't build a background yet; the text waits here and
        // fires for real once the registry lands.
        this._pendingText = null;
        // Display-only: never a hit target (the stage is interactive for mobile pinch).
        this.eventMode = "none";
        this.zIndex = 11000;
        this.visible = false;
        this._timer = null;

        this._panel = new Container();
        this._frame = null;
        this._inset = null;
        this._text = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: 15, fill: PANEL_TEXT},
        });
        this._panel.addChild(this._text);
        this.addChild(this._panel);
        app.renderer.on("resize", () => this._center());
    }

    /**
     * @returns {TextureRegistry|null}
     */
    get textureRegistry() {
        return this._textureRegistry;
    }

    /**
     * @param {TextureRegistry} registry
     */
    set textureRegistry(registry) {
        this._textureRegistry = registry;
        if (this._pendingText !== null) {
            const text = this._pendingText;
            this._pendingText = null;
            this.notify(text);
        }
    }

    /**
     * Shows a message for {@link NOTICE_DURATION_MS}, replacing and re-timing any notice
     * already showing.
     * @param {string} text
     * @returns {void}
     */
    notify(text) {
        if (this._textureRegistry === null) {
            this._pendingText = text;
            return;
        }
        this._text.text = text;
        const width = this._text.width + (PADDING_X + FRAME_MARGIN) * 2;
        const height = this._text.height + (PADDING_Y + FRAME_MARGIN) * 2;
        this._rebuildBackground(width, height);
        this._text.x = FRAME_MARGIN + PADDING_X;
        this._text.y = FRAME_MARGIN + PADDING_Y;
        this._center();
        this.visible = true;
        if (this._timer !== null) {
            clearTimeout(this._timer);
        }
        this._timer = setTimeout(() => {
            this._timer = null;
            this.visible = false;
        }, NOTICE_DURATION_MS);
    }

    /**
     * @private
     * @param {number} width
     * @param {number} height
     * @returns {void}
     */
    _rebuildBackground(width, height) {
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
     * @private
     * @returns {void}
     */
    _center() {
        this._panel.x = Math.round((this._app.screen.width - this._panel.width) / 2);
        this._panel.y = this._app.screen.height - this._panel.height - MARGIN;
    }
}
