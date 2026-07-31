import {Container, Graphics, Text} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_TEXT} from "@/client/Theme.js";
import {drawPanelBackground} from "@/client/icons.js";

const MARGIN = 24;
const PADDING_X = 16;
const PADDING_Y = 12;

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
        // Display-only: never a hit target (the stage is interactive for mobile pinch).
        this.eventMode = "none";
        this.zIndex = 11000;
        this.visible = false;
        this._timer = null;

        this._panel = new Container();
        this._background = new Graphics();
        this._text = new Text({
            text: "",
            style: {fontFamily: GAME_FONT, fontSize: 15, fill: PANEL_TEXT},
        });
        this._text.x = PADDING_X;
        this._text.y = PADDING_Y;
        this._panel.addChild(this._background);
        this._panel.addChild(this._text);
        this.addChild(this._panel);
        app.renderer.on("resize", () => this._center());
    }

    /**
     * Shows a message for {@link NOTICE_DURATION_MS}, replacing and re-timing any notice
     * already showing.
     * @param {string} text
     * @returns {void}
     */
    notify(text) {
        this._text.text = text;
        this._background.clear();
        drawPanelBackground(this._background, this._text.width + PADDING_X * 2, this._text.height + PADDING_Y * 2);
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
     * @returns {void}
     */
    _center() {
        this._panel.x = Math.round((this._app.screen.width - this._panel.width) / 2);
        this._panel.y = this._app.screen.height - this._panel.height - MARGIN;
    }
}
