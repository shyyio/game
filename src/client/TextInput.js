import {Container, Graphics} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_BORDER, ACTIVE_ACCENT} from "@/client/Theme.js";

const FONT_SIZE = 15;
const PADDING_X = 8;
const BOX_FILL = 0xffffff;
const BOX_FILL_ALPHA = 0.85;
const BORDER_WIDTH = 2;
const CORNER_RADIUS = 4;

/**
 * A single-line text input: a themed pixi box behind a real, fully interactive, exactly-overlaid
 * DOM `<input>`. The browser owns focus, typing, IME, IME candidate windows, mouse/keyboard text
 * selection, and paste natively — pixi only draws the frame, kept under the real input every
 * tick (so it tracks the host panel being dragged). Native focus/blur drive {@link _focused};
 * clicking anywhere else blurs it the same way it would blur any other page input.
 */
export class TextInput extends Container {

    /**
     * @param {Application} app - for mapping the widget's screen position onto the DOM input
     * @param {number} width
     * @param {number} height
     * @param {number} maxLength
     * @param {string} [placeholder]
     */
    constructor(app, width, height, maxLength, placeholder = "") {
        super();
        this._app = app;
        this._width = width;
        this._height = height;
        this._focused = false;
        this._onSubmit = null;
        this._onInput = null;
        // Last screen rect actually written to the DOM input; skips the style writes on the
        // (overwhelming majority of) ticks where nothing moved.
        this._lastLeft = null;
        this._lastTop = null;
        this._lastWidth = null;
        this._lastHeight = null;

        this._domInput = document.createElement("input");
        this._domInput.type = "text";
        this._domInput.maxLength = maxLength;
        this._domInput.placeholder = placeholder;
        this._domInput.autocomplete = "off";
        this._domInput.autocapitalize = "off";
        this._domInput.spellcheck = false;
        Object.assign(this._domInput.style, {
            position: "fixed",
            zIndex: "1000",
            left: "0px",
            top: "0px",
            width: "1px",
            height: "1px",
            boxSizing: "border-box",
            background: "transparent",
            border: "none",
            outline: "none",
            padding: `0 ${PADDING_X}px`,
            fontFamily: GAME_FONT,
            fontSize: `${FONT_SIZE}px`,
            color: "#000000",
        });
        document.body.appendChild(this._domInput);
        this._domInput.addEventListener("input", () => {
            if (this._onInput !== null) {
                this._onInput(this._domInput.value);
            }
        });
        this._domInput.addEventListener("keydown", (event) => {
            // Keeps this from also firing game hotkeys (r, e, ...) while typing.
            event.stopPropagation();
            if (event.key === "Enter") {
                event.preventDefault();
                if (this._onSubmit !== null) {
                    this._onSubmit(this._domInput.value);
                }
            } else if (event.key === "Escape") {
                this.blur();
            }
        });
        this._domInput.addEventListener("focus", () => {
            this._focused = true;
            this._render();
        });
        this._domInput.addEventListener("blur", () => {
            this._focused = false;
            this._render();
        });

        this._box = new Graphics();
        this.addChild(this._box);

        // Keeps the real input glued under the pixi box even if the host panel gets dragged.
        this._tick = () => this._positionDomInput();
        app.ticker.add(this._tick);

        this._render();
    }

    /**
     * @returns {string}
     */
    get value() {
        return this._domInput.value;
    }

    /**
     * @param {string} value
     */
    set value(value) {
        this._domInput.value = value;
    }

    /**
     * @param {function(value: string): void} callback fired on Enter
     */
    onSubmit(callback) {
        this._onSubmit = callback;
    }

    /**
     * @param {function(value: string): void} callback fired on every keystroke that changes the text
     */
    onInput(callback) {
        this._onInput = callback;
    }

    /**
     * @returns {void}
     */
    focus() {
        this._domInput.focus({preventScroll: true});
    }

    /**
     * @returns {void}
     */
    blur() {
        this._domInput.blur();
    }

    /**
     * @returns {void}
     */
    clear() {
        this._domInput.value = "";
    }

    /**
     * @param {object} [options]
     * @returns {void}
     */
    destroy(options) {
        this._app.ticker.remove(this._tick);
        this._domInput.remove();
        super.destroy(options);
    }

    /**
     * Moves the real input to overlay this widget's actual screen rect; a no-op once that rect
     * stops changing (dragging the host panel aside, the common case every tick).
     * @private
     * @returns {void}
     */
    _positionDomInput() {
        const bounds = this.getBounds();
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
        this._domInput.style.left = `${left}px`;
        this._domInput.style.top = `${top}px`;
        this._domInput.style.width = `${width}px`;
        this._domInput.style.height = `${height}px`;
    }

    /**
     * @private
     * @returns {void}
     */
    _render() {
        this._box.clear();
        this._box
            .roundRect(0, 0, this._width, this._height, CORNER_RADIUS)
            .fill({color: BOX_FILL, alpha: BOX_FILL_ALPHA})
            .stroke({color: this._focused ? ACTIVE_ACCENT : PANEL_BORDER, width: BORDER_WIDTH});
    }
}
