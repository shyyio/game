import {Container, Rectangle} from "pixi.js";
import {HudLayer} from "@/client/hud/HudLayer.js";
import {trackTap} from "@/client/layers/pixiUtils.js";

// Clearance between a popover and the control it drops from.
const POPOVER_GAP = 4;
// Clearance between a popover and the screen edge.
const POPOVER_MARGIN = 8;

/**
 * The one place a transient overlay opens: a dropdown list, an icon grid, anything that drops from
 * a control and is dismissed by tapping away. Drops below its anchor, flips above when it would run
 * off the bottom, and clamps to the screen's edges.
 *
 * One popover is open at a time, and it lives here rather than inside the panel that opened it, so
 * it outranks every panel and a panel rebuild underneath leaves it alone.
 */
export class PopoverHost extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this._app = app;
        this.zIndex = HudLayer.POPOVER;
        this.visible = false;
        this._content = null;
        this._onClose = null;

        // Invisible, full-screen, below the content: a tap anywhere off the popover dismisses it.
        this._catcher = new Container();
        this._catcher.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);
        trackTap(this._catcher, () => this.close());
        this.addChild(this._catcher);

        app.renderer.on("resize", () => this._resizeCatcher());
    }

    /**
     * @returns {boolean}
     */
    get isOpen() {
        return this._content !== null;
    }

    /**
     * Opens `content` under `anchorTo`, replacing whatever was open.
     * @param {object} options
     * @param {Container} options.content
     * @param {number} options.height - the content's height, which it alone knows how to measure
     * @param {Container} options.anchorTo - the control the popover drops from
     * @param {function(): void} [options.onClose] - fired on any close, dismissal included
     * @returns {void}
     */
    open({content, height, anchorTo, onClose}) {
        this.close();
        const anchor = anchorTo.getBounds();
        content.x = Math.max(
            POPOVER_MARGIN,
            Math.min(anchor.x, this._app.screen.width - content.width - POPOVER_MARGIN),
        );
        content.y = anchor.y + anchor.height + POPOVER_GAP;
        // Flipped above the anchor when it would otherwise run off the bottom.
        if (content.y + height > this._app.screen.height - POPOVER_MARGIN) {
            content.y = Math.max(POPOVER_MARGIN, anchor.y - POPOVER_GAP - height);
        }
        content.eventMode = "static";
        this._content = content;
        if (onClose === undefined) {
            this._onClose = null;
        } else {
            this._onClose = onClose;
        }
        this.addChild(content);
        this.visible = true;
    }

    /**
     * Closes the open popover, destroying its content; a no-op when none is open.
     * @returns {void}
     */
    close() {
        if (this._content === null) {
            return;
        }
        const onClose = this._onClose;
        this._content.destroy({children: true});
        this._content = null;
        this._onClose = null;
        this.visible = false;
        if (onClose !== null) {
            onClose();
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _resizeCatcher() {
        this._catcher.hitArea = new Rectangle(0, 0, this._app.screen.width, this._app.screen.height);
    }
}
