import {Container, Text} from "pixi.js";
import {APP_VERSION, BUILD_DATE} from "@/common/env.js";
import {GAME_FONT} from "@/client/constants.js";
import {HudLayer} from "@/client/hud/HudLayer.js";
import Mobile from "@/client/Mobile.js";
import SafeArea from "@/client/SafeArea.js";

// Screen-pixel inset from the bottom-left corner.
const MARGIN = 12;

// A watermark, not a readable label: it must not compete with the world behind it.
const WATERMARK_ALPHA = 0.5;
const WATERMARK_COLOR = 0x000000;

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric", year: "numeric"});

/**
 * @returns {string} the version, with the build date when the bundle carries one
 */
function watermarkText() {
    if (BUILD_DATE === null) {
        return `v${APP_VERSION}`;
    }
    return `v${APP_VERSION} | ${DATE_FORMAT.format(new Date(BUILD_DATE))}`;
}

/**
 * Bottom-left build watermark showing the game version and build date. Desktop only: touch layouts need the
 * corner, and the toolbar sits there.
 */
export class VersionWatermarkLayer extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this._app = app;
        // Display-only: never a hit target (the stage is interactive for mobile pinch).
        this.eventMode = "none";
        this.zIndex = HudLayer.WATERMARK;
        this.alpha = WATERMARK_ALPHA;
        this._text = new Text({
            text: watermarkText(),
            style: {fontFamily: GAME_FONT, fontSize: 13, fill: WATERMARK_COLOR},
        });
        this.addChild(this._text);
        this.refresh();
        app.renderer.on("resize", () => this._layout());
    }

    /**
     * Re-reads the touchscreen-input setting and repositions.
     * @returns {void}
     */
    refresh() {
        this.visible = !Mobile.enabled;
        this._layout();
    }

    /**
     * @private
     * @returns {void}
     */
    _layout() {
        const insets = SafeArea.insets();
        this._text.x = insets.left + MARGIN;
        this._text.y = this._app.screen.height - insets.bottom - MARGIN - this._text.height;
    }
}
