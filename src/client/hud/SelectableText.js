import {DomOverlay} from "@/client/hud/DomOverlay.js";

/**
 * Makes a pixi Text natively selectable/copyable without changing how it looks: an invisible
 * (transparent) readonly DOM `<input>` holding the same string, kept exactly overlaid on the
 * pixi Text's screen rect every tick. An `<input>` (not a plain element) so its selection is
 * scoped to itself even on mobile - a `<div>` here lets a mobile "Select All" gesture grab the
 * whole page's selectable text instead of just this value. The browser owns selection/copy;
 * pixi keeps drawing the visible glyphs underneath, so nothing looks different from a plain
 * {@link panelText}.
 */
export class SelectableText {

    /**
     * @param {Application} app - for mapping the target's screen position onto the DOM overlay
     * @param {Text} target - the pixi Text to overlay; swap with {@link setTarget} if it's
     * recreated (e.g. on a panel rebuild)
     */
    constructor(app, target) {
        this._app = app;
        this._target = target;

        const element = document.createElement("input");
        element.type = "text";
        element.readOnly = true;
        document.body.appendChild(element);
        this._overlay = new DomOverlay(element, {
            boxSizing: "border-box",
            padding: "0",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "transparent",
            caretColor: "transparent",
            cursor: "text",
            fontFamily: target.style.fontFamily,
            fontSize: `${target.style.fontSize}px`,
        });

        this._tick = () => this._position();
        app.ticker.add(this._tick);
        this._position();
    }

    /**
     * @param {Text} target
     * @returns {void}
     */
    setTarget(target) {
        this._target = target;
        this._overlay.invalidate();
        this._position();
    }

    /**
     * @param {string} text
     * @returns {void}
     */
    setText(text) {
        this._overlay.element.value = text;
    }

    /**
     * @returns {void}
     */
    destroy() {
        this._app.ticker.remove(this._tick);
        this._overlay.remove();
    }

    /**
     * @private
     * @returns {void}
     */
    _position() {
        this._overlay.sync(this._target.getBounds(), this._app.canvas.getBoundingClientRect());
    }
}
