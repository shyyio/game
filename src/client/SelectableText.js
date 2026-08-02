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
        this._lastLeft = null;
        this._lastTop = null;
        this._lastWidth = null;
        this._lastHeight = null;

        this._dom = document.createElement("input");
        this._dom.type = "text";
        this._dom.readOnly = true;
        Object.assign(this._dom.style, {
            position: "fixed",
            zIndex: "1000",
            left: "0px",
            top: "0px",
            width: "1px",
            height: "1px",
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
        document.body.appendChild(this._dom);

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
        this._lastLeft = null;
        this._position();
    }

    /**
     * @param {string} text
     * @returns {void}
     */
    setText(text) {
        this._dom.value = text;
    }

    /**
     * @returns {void}
     */
    destroy() {
        this._app.ticker.remove(this._tick);
        this._dom.remove();
    }

    /**
     * @private
     * @returns {void}
     */
    _position() {
        const bounds = this._target.getBounds();
        const canvasRect = this._app.canvas.getBoundingClientRect();
        const left = canvasRect.left + bounds.x;
        const top = canvasRect.top + bounds.y;
        const width = Math.max(bounds.width, 1);
        const height = Math.max(bounds.height, 1);
        if (left === this._lastLeft && top === this._lastTop && width === this._lastWidth && height === this._lastHeight) {
            return;
        }
        this._lastLeft = left;
        this._lastTop = top;
        this._lastWidth = width;
        this._lastHeight = height;
        this._dom.style.left = `${left}px`;
        this._dom.style.top = `${top}px`;
        this._dom.style.width = `${width}px`;
        this._dom.style.height = `${height}px`;
    }
}
