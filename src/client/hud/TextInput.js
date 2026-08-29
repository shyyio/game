import {CanvasTextMetrics, Container, Graphics, Rectangle, Text, TextStyle} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_BORDER, ACTIVE_ACCENT} from "@/client/Theme.js";
import {HUD_DOM_Z_INDEX} from "@/client/hud/HudLayer.js";
import {isTopmostAt} from "@/client/layers/pixiUtils.js";

// Exported for the contrast audit, which reads what the box really paints rather than restating it.
export const FONT_SIZE = 15;
export const BOX_FILL = 0xffffff;
export const BOX_FILL_ALPHA = 0.85;
export const TEXT_COLOR = 0x000000;
// As light as a placeholder can go and still clear AAA on the box's near-white fill.
export const PLACEHOLDER_COLOR = 0x565656;

const PADDING_X = 8;
const BORDER_WIDTH = 2;
const CORNER_RADIUS = 4;
const SELECTION_COLOR = 0xb4d5fe;
const CARET_WIDTH = 2;
// Half the blink period; the caret shows solid for this long, then hides for as long.
const CARET_BLINK_MS = 530;
// A composing IME string is underlined, the convention every native text field uses.
const COMPOSITION_UNDERLINE_HEIGHT = 1;

/**
 * A single-line text input drawn entirely by pixi: the themed box, the glyphs, the selection
 * highlight, the caret, and an IME composition underline. A real `<input>` stays exactly overlaid
 * but fully transparent, so the browser still owns focus, typing, composition, clipboard, the
 * native selection model, and raising the on-screen keyboard on touch, while painting nothing.
 *
 * Painting in pixi is what makes the input obey the HUD's stacking order: a DOM element floats
 * above the canvas whatever its z-index, so anything drawn over it used to have to hide it.
 */
export class TextInput extends Container {

    /**
     * @param {Application} app - for mapping the widget's screen position onto the DOM input
     * @param {number} width
     * @param {number} height
     * @param {number} maxLength
     * @param {string} [placeholder]
     * @param {boolean} [numeric] - raises the numeric keyboard on touch devices
     */
    constructor(app, width, height, maxLength, placeholder = "", numeric = false) {
        super();
        this._app = app;
        this._width = width;
        this._height = height;
        this._focused = false;
        this._onSubmit = null;
        this._onInput = null;
        this._onBlur = null;
        // Screen rect the DOM input is clipped to (a host ScrollView's viewport); null = unclipped.
        // The input paints nothing, so this clips what it can still capture: pointer events.
        this._clipProvider = null;
        this._domShown = true;
        // Last screen rect actually written to the DOM input; skips the style writes on the
        // (overwhelming majority of) ticks where nothing moved.
        this._lastLeft = null;
        this._lastTop = null;
        this._lastWidth = null;
        this._lastHeight = null;
        // Last painted selection, so the tick repaints only when the caret actually moved.
        this._lastSelectionStart = null;
        this._lastSelectionEnd = null;
        this._lastText = null;
        // The composing IME range, or null; drawn underlined until the composition commits.
        this._composition = null;
        this._caretVisibleAt = 0;
        this._caretOn = true;
        // How far the text is scrolled left to keep the caret inside the box.
        this._scrollX = 0;

        this._buildDomInput(maxLength, placeholder, numeric);
        this._buildContent(placeholder);

        this._tick = () => this._update();
        app.ticker.add(this._tick);

        this._renderBox();
        this._renderText();
    }

    /**
     * The transparent `<input>` the browser drives: focus, typing, composition, clipboard, and the
     * touch keyboard. Its glyphs and caret are transparent because pixi draws both.
     * @private
     * @param {number} maxLength
     * @param {string} placeholder
     * @param {boolean} numeric
     * @returns {void}
     */
    _buildDomInput(maxLength, placeholder, numeric) {
        this._domInput = document.createElement("input");
        this._domInput.type = "text";
        this._domInput.maxLength = maxLength;
        this._domInput.autocomplete = "off";
        // Never the placeholder attribute: `::placeholder` is UA-styled, so `color: transparent`
        // would not hide it and the browser would paint its own over pixi's. Screen readers get
        // the same string through the label instead.
        if (placeholder !== "") {
            this._domInput.setAttribute("aria-label", placeholder);
        }
        if (numeric) {
            this._domInput.inputMode = "numeric";
        }
        this._domInput.autocapitalize = "off";
        this._domInput.spellcheck = false;
        Object.assign(this._domInput.style, {
            position: "fixed",
            zIndex: HUD_DOM_Z_INDEX,
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
            // Both transparent: pixi paints the glyphs and the caret.
            color: "transparent",
            caretColor: "transparent",
        });
        document.body.appendChild(this._domInput);
        this._placeholder = placeholder;

        this._domInput.addEventListener("input", () => {
            this._renderText();
            if (this._onInput !== null) {
                this._onInput(this._domInput.value);
            }
        });
        this._domInput.addEventListener("keydown", (event) => {
            // Keeps this from also firing game hotkeys (r, e, ...) while typing.
            event.stopPropagation();
            // Any key press restarts the blink, so the caret is solid while typing.
            this._restartCaretBlink();
            if (event.key === "Enter") {
                event.preventDefault();
                if (this._onSubmit !== null) {
                    this._onSubmit(this._domInput.value);
                }
            } else if (event.key === "Escape") {
                this.blur();
            }
        });
        this._domInput.addEventListener("compositionstart", () => {
            this._composition = {start: this._domInput.selectionStart, length: 0};
        });
        this._domInput.addEventListener("compositionupdate", (event) => {
            if (this._composition !== null) {
                this._composition.length = event.data.length;
            }
            this._renderText();
        });
        this._domInput.addEventListener("compositionend", () => {
            this._composition = null;
            this._renderText();
        });
        this._domInput.addEventListener("focus", () => {
            this._focused = true;
            this._restartCaretBlink();
            this._renderBox();
            this._renderText();
        });
        this._domInput.addEventListener("blur", () => {
            this._focused = false;
            this._composition = null;
            this._renderBox();
            this._renderText();
            if (this._onBlur !== null) {
                this._onBlur(this._domInput.value);
            }
        });
    }

    /**
     * The pixi side: the box, then the scrolled and clipped content over it.
     * @private
     * @param {string} placeholder
     * @returns {void}
     */
    _buildContent(placeholder) {
        // Hit-testable so pixi can be asked whether anything is drawn over this input; the DOM
        // element above the canvas takes itself out of hit-testing whenever something is.
        this.eventMode = "static";
        this.hitArea = new Rectangle(0, 0, this._width, this._height);

        this._box = new Graphics();
        this.addChild(this._box);

        this._style = new TextStyle({fontFamily: GAME_FONT, fontSize: FONT_SIZE, fill: TEXT_COLOR});
        // Measured off a reference string: an empty Text has no height, and the caret still needs one.
        this._lineHeight = CanvasTextMetrics.measureText("Mg", this._style).height;
        this._textY = (this._height - this._lineHeight) / 2;

        // Everything inside the box scrolls together, clipped to the box's inner width.
        this._content = new Container();
        this._content.x = PADDING_X;
        this.addChild(this._content);
        const mask = new Graphics()
            .rect(PADDING_X, 0, this._innerWidth(), this._height)
            .fill(0xffffff);
        this.addChild(mask);
        this._content.mask = mask;

        this._selection = new Graphics();
        this._content.addChild(this._selection);

        this._text = new Text({text: "", style: this._style});
        this._text.y = this._textY;
        this._content.addChild(this._text);

        this._placeholderText = new Text({
            text: placeholder,
            style: new TextStyle({fontFamily: GAME_FONT, fontSize: FONT_SIZE, fill: PLACEHOLDER_COLOR}),
        });
        this._placeholderText.y = this._textY;
        this._content.addChild(this._placeholderText);

        this._caret = new Graphics();
        this._content.addChild(this._caret);

        this._compositionLine = new Graphics();
        this._content.addChild(this._compositionLine);
    }

    /**
     * @private
     * @returns {number} the width available for text inside the box's padding
     */
    _innerWidth() {
        return this._width - PADDING_X * 2;
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
        this._renderText();
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
     * @param {function(value: string): void} callback fired when the input loses focus
     */
    onBlur(callback) {
        this._onBlur = callback;
    }

    /**
     * Clips the DOM input to the screen rect `provider` returns each tick, so an input scrolled out
     * of its host's viewport stops capturing taps there; the pixi mask handles the drawing.
     * @param {function(): {x: number, y: number, width: number, height: number}} provider
     * @returns {void}
     */
    setClip(provider) {
        this._clipProvider = provider;
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
        this._renderText();
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
     * Per tick: keep the hidden input glued to the box, and repaint when the caret blinks or the
     * selection moved under us (arrow keys and drag-select fire no input event).
     * @private
     * @returns {void}
     */
    _update() {
        this._positionDomInput();
        if (!this._focused) {
            return;
        }
        if (this._domInput.selectionStart !== this._lastSelectionStart
            || this._domInput.selectionEnd !== this._lastSelectionEnd
            || this._domInput.value !== this._lastText) {
            this._renderText();
            return;
        }
        const on = (Date.now() - this._caretVisibleAt) % (CARET_BLINK_MS * 2) < CARET_BLINK_MS;
        if (on !== this._caretOn) {
            this._caretOn = on;
            // A selection draws no caret to blink.
            this._caret.visible = on && this._domInput.selectionStart === this._domInput.selectionEnd;
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _restartCaretBlink() {
        this._caretVisibleAt = Date.now();
        this._caretOn = true;
    }

    /**
     * Moves the real input to overlay this widget's actual screen rect; a no-op once that rect
     * stops changing (dragging the host panel aside, the common case every tick).
     * @private
     * @returns {void}
     */
    _positionDomInput() {
        // The input captures pointer events over every pixi layer, so a hidden widget (a collapsed
        // section, a closed panel) must take its input with it. Walked by hand: pixi v8 has no
        // worldVisible.
        let shown = this.visible;
        for (let node = this.parent; shown && node !== null; node = node.parent) {
            shown = node.visible;
        }
        if (shown !== this._domShown) {
            this._domShown = shown;
            if (shown) {
                this._domInput.style.display = "block";
            } else {
                this._domInput.style.display = "none";
            }
        }
        if (!shown) {
            return;
        }
        const bounds = this.getBounds();
        // Every tick, not just on a move: what covers this input can change while it sits still.
        this._deferToCover(bounds);
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
        this._applyClip(bounds, canvasRect);
    }

    /**
     * Gives pixi the last word on whether this input is reachable: anything drawn over it (a
     * dropdown, a dialog) wins the pointer, which a DOM element floating above the canvas would
     * otherwise take for itself. Sampled at the box's center, the point a cover always covers.
     * @private
     * @param {Bounds} bounds - this widget's canvas-space bounds
     * @returns {void}
     */
    _deferToCover(bounds) {
        const covered = !isTopmostAt(
            this._app.renderer.events.rootBoundary,
            this,
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
        );
        this._domInput.style.pointerEvents = covered ? "none" : "auto";
        // Keystrokes must not keep reaching a box the player can no longer see; the blur commits it.
        if (covered && this._focused) {
            this.blur();
        }
    }

    /**
     * Mirrors the host's pixi mask onto the DOM input, so it captures pointer events only where it
     * is really on screen: fully outside takes it out of hit-testing, partially outside clips it.
     * @private
     * @param {Bounds} bounds - this widget's canvas-space bounds
     * @param {DOMRect} canvasRect
     * @returns {void}
     */
    _applyClip(bounds, canvasRect) {
        if (this._clipProvider === null) {
            return;
        }
        const clip = this._clipProvider();
        const top = Math.max(0, clip.y - bounds.y);
        const bottom = Math.max(0, (bounds.y + bounds.height) - (clip.y + clip.height));
        const left = Math.max(0, clip.x - bounds.x);
        const right = Math.max(0, (bounds.x + bounds.width) - (clip.x + clip.width));
        if (top >= bounds.height || bottom >= bounds.height || left >= bounds.width || right >= bounds.width) {
            this._domInput.style.visibility = "hidden";
            return;
        }
        this._domInput.style.visibility = "visible";
        if (top === 0 && bottom === 0 && left === 0 && right === 0) {
            this._domInput.style.clipPath = "none";
            return;
        }
        this._domInput.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
    }

    /**
     * The x offset of character `index`, measured the way pixi lays the text out so the caret lands
     * exactly between glyphs.
     * @private
     * @param {number} index
     * @returns {number}
     */
    _offsetOf(index) {
        if (index <= 0) {
            return 0;
        }
        return CanvasTextMetrics.measureText(this._domInput.value.slice(0, index), this._style).width;
    }

    /**
     * @private
     * @returns {void}
     */
    _renderBox() {
        // The stroke centers on its path, so the rect is inset by half of it: the box then measures
        // exactly the size it was built at, and a row laying it out gets the width it asked for.
        const inset = BORDER_WIDTH / 2;
        this._box.clear();
        this._box
            .roundRect(inset, inset, this._width - BORDER_WIDTH, this._height - BORDER_WIDTH, CORNER_RADIUS)
            .fill({color: BOX_FILL, alpha: BOX_FILL_ALPHA})
            .stroke({color: this._focused ? ACTIVE_ACCENT : PANEL_BORDER, width: BORDER_WIDTH});
    }

    /**
     * Paints the glyphs, the selection behind them, the caret, and any composition underline, then
     * scrolls the lot so the caret stays inside the box.
     * @private
     * @returns {void}
     */
    _renderText() {
        const value = this._domInput.value;
        this._lastText = value;
        this._text.text = value;
        // Native placeholders stay up while the box is focused and empty.
        this._placeholderText.visible = value.length === 0;

        const start = this._domInput.selectionStart;
        const end = this._domInput.selectionEnd;
        this._lastSelectionStart = start;
        this._lastSelectionEnd = end;

        this._selection.clear();
        this._caret.visible = false;
        this._compositionLine.clear();
        if (!this._focused) {
            this._scrollTo(0);
            return;
        }

        const caretX = this._offsetOf(end);
        if (start !== end) {
            const from = this._offsetOf(start);
            this._selection
                .rect(from, this._textY, caretX - from, this._lineHeight)
                .fill(SELECTION_COLOR);
        } else {
            this._caret.clear()
                .rect(caretX, this._textY, CARET_WIDTH, this._lineHeight)
                .fill(TEXT_COLOR);
            this._caret.visible = this._caretOn;
        }

        if (this._composition !== null && this._composition.length > 0) {
            const from = this._offsetOf(this._composition.start);
            const to = this._offsetOf(this._composition.start + this._composition.length);
            this._compositionLine
                .rect(from, this._textY + this._lineHeight, to - from, COMPOSITION_UNDERLINE_HEIGHT)
                .fill(TEXT_COLOR);
        }
        this._scrollTo(caretX);
    }

    /**
     * Scrolls the content so `caretX` stays inside the box, and no further left than the start.
     * @private
     * @param {number} caretX
     * @returns {void}
     */
    _scrollTo(caretX) {
        const inner = this._innerWidth();
        let scroll = this._scrollX;
        if (caretX - scroll > inner) {
            scroll = caretX - inner;
        }
        if (caretX - scroll < 0) {
            scroll = caretX;
        }
        // Never leave a gap at the right once the text is short enough to fit.
        const overflow = Math.max(this._text.width - inner, 0);
        scroll = Math.min(Math.max(scroll, 0), overflow);
        this._scrollX = scroll;
        this._content.x = PADDING_X - scroll;
    }
}
