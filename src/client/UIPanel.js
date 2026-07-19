import {Container, Sprite, Text, NineSliceSprite, TilingSprite, Rectangle} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {debugOutlines} from "@/client/pixiUtils.js";

const TITLE_ROW_HEIGHT = 40;
const PADDING = 8;
// Gap between the outer frame and the inset body, so the outer border shows around it.
const BODY_MARGIN = 8;
const CLOSE_SIZE = 25;
const TITLE_FONT_SIZE = 18;

// Tiled pattern after the title, filling up to the close button.
const PATTERN_GAP = 7;
const TITLE_GAP = 5;
const PATTERN_HEIGHT = 24;
const PATTERN_ALPHA = 0.23;
// Atlas frames are 2x (TexturePacker scale), so halve the tile to draw at authored size.
const PATTERN_SCALE = 0.5;
// On-screen tile period (PlusPattern is an 8px tile authored 2x, drawn at PATTERN_SCALE).
const PATTERN_TILE = 16 * PATTERN_SCALE;

// 9-slice edge inset (atlas pixels); the frame renders its border at FRAME_SCALE (corners scale too).
const FRAME_INSET = 12;
const FRAME_SCALE = 0.70;

// Keep a dragged panel at least this far from the screen edges.
const EDGE_MARGIN = 3;

// Drop shadow shown while the panel is hovered (offset left + down).
const SHADOW_OFFSET_X = -2;
const SHADOW_OFFSET_Y = 2;
const SHADOW_ALPHA = 0.20;

const TX_FRAME = "ui/Frame02a";
const TX_FRAME_INSET = "ui/Frame02a_inset2";
const TX_CLOSE = "ui/IconCross01a";
const TX_PATTERN = "ui/PlusPattern";

/**
 * A framed HUD panel: raised outer frame + sunken inset body + draggable title bar with a close
 * button. Chrome only — callers fill the body via {@link UIPanel#addContent}. The host wires
 * dragging onto {@link UIPanel#dragHandle}.
 */
export class UIPanel extends Container {

    /**
     * @param {object} options
     * @param {Application} options.app - for clamping drags to the screen
     * @param {TextureRegistry} options.textureRegistry
     * @param {string} options.title
     * @param {number} options.titleColor
     * @param {number} options.tint - outer frame background tint
     * @param {number} options.width
     * @param {number} options.height
     * @param {function(): void} [options.onClose] - invoked when the close button is pressed
     */
    constructor(options) {
        super();
        this._app = options.app;
        this._textureRegistry = options.textureRegistry;
        this._title = options.title;
        this._titleColor = options.titleColor;
        this._tint = options.tint;
        this._width = options.width;
        this._height = options.height;
        this._onClose = options.onClose === undefined ? null : options.onClose;

        // Caller children; its origin is the body's top-left corner after padding.
        this.content = new Container();
        this.content.x = BODY_MARGIN + PADDING;
        this.content.y = TITLE_ROW_HEIGHT + PADDING;

        // Title bar container, exposed so the host can attach drag handlers.
        this.dragHandle = null;
        this._debugOutlines = null;
        this._shadow = null;

        this._build();
        this._makeDraggable();

        // Hover drop shadow, only over the title bar.
        this.dragHandle.on("pointerenter", () => this._showShadow());
        this.dragHandle.on("pointerleave", () => this._hideShadow());
    }

    /**
     * Adds the hover drop shadow behind the panel.
     * @returns {void}
     * @private
     */
    _showShadow() {
        if (this._shadow !== null) {
            return;
        }
        // Same 9-slice frame as the panel background, so the shadow matches its exact shape.
        const shadow = this._nineSlice(TX_FRAME, this._width, this._height);
        shadow.tint = 0x000000;
        shadow.alpha = SHADOW_ALPHA;
        shadow.x = SHADOW_OFFSET_X;
        shadow.y = SHADOW_OFFSET_Y;
        this.addChildAt(shadow, 0);
        this._shadow = shadow;
    }

    /**
     * Removes the hover drop shadow.
     * @returns {void}
     * @private
     */
    _hideShadow() {
        if (this._shadow !== null) {
            this._shadow.destroy();
            this._shadow = null;
        }
    }

    /**
     * Wires the title bar to drag the panel.
     * @returns {void}
     * @private
     */
    _makeDraggable() {
        this.dragHandle.eventMode = "static";
        this.dragHandle.cursor = "pointer";
        this.dragHandle.on("pointerdown", (e) => {
            e.stopPropagation();
            e.nativeEvent.stopPropagation();
            this._startDrag(e.nativeEvent);
        });
    }

    /**
     * Tracks a title-bar drag through window pointer events until release, clamped to the screen.
     * @param {PointerEvent} event
     * @returns {void}
     * @private
     */
    _startDrag(event) {
        this._raise();
        const startX = event.clientX;
        const startY = event.clientY;
        const originX = this.x;
        const originY = this.y;
        const screen = this._app.screen;
        const onMove = (ev) => {
            const maxX = screen.width - EDGE_MARGIN - this._width;
            const maxY = screen.height - EDGE_MARGIN - this._height;
            this.x = Math.min(Math.max(originX + (ev.clientX - startX), EDGE_MARGIN), maxX);
            this.y = Math.min(Math.max(originY + (ev.clientY - startY), EDGE_MARGIN), maxY);
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }

    /**
     * The total panel height that fits a body content area of the given height.
     * @param {number} contentHeight
     * @returns {number}
     */
    static heightForContent(contentHeight) {
        return contentHeight + TITLE_ROW_HEIGHT + BODY_MARGIN + 2 * PADDING;
    }

    /**
     * The panel's raised outer frame as a standalone tinted 9-slice sprite (for chrome that wants the
     * UIPanel look without the rest of the panel). Sets a hit area so it can catch pointer events.
     * @param {TextureRegistry} textureRegistry
     * @param {number} width
     * @param {number} height
     * @param {number} tint
     * @returns {NineSliceSprite}
     */
    static frameSprite(textureRegistry, width, height, tint) {
        const sprite = new NineSliceSprite({
            texture: textureRegistry.get(TX_FRAME),
            leftWidth: FRAME_INSET,
            rightWidth: FRAME_INSET,
            topHeight: FRAME_INSET,
            bottomHeight: FRAME_INSET,
        });
        sprite.width = width / FRAME_SCALE;
        sprite.height = height / FRAME_SCALE;
        sprite.scale.set(FRAME_SCALE);
        sprite.tint = tint;
        sprite.hitArea = new Rectangle(0, 0, width / FRAME_SCALE, height / FRAME_SCALE);
        return sprite;
    }

    /**
     * The panel's sunken inset body as a standalone tinted 9-slice sprite, matching the inspect
     * panel's body (for chrome that wants the inset look without the rest of the panel).
     * @param {TextureRegistry} textureRegistry
     * @param {number} width
     * @param {number} height
     * @param {number} tint
     * @returns {NineSliceSprite}
     */
    static insetSprite(textureRegistry, width, height, tint) {
        const sprite = new NineSliceSprite({
            texture: textureRegistry.get(TX_FRAME_INSET),
            leftWidth: FRAME_INSET,
            rightWidth: FRAME_INSET,
            topHeight: FRAME_INSET,
            bottomHeight: FRAME_INSET,
        });
        sprite.width = width / FRAME_SCALE;
        sprite.height = height / FRAME_SCALE;
        sprite.scale.set(FRAME_SCALE);
        sprite.tint = tint;
        return sprite;
    }

    /**
     * A standalone tiled decorative pattern rectangle, matching the title bar's strip (same texture,
     * scale, and alpha), for chrome that wants the pattern outside a full panel.
     * @param {TextureRegistry} textureRegistry
     * @param {number} width
     * @param {number} height
     * @returns {TilingSprite}
     */
    static patternStrip(textureRegistry, width, height) {
        const strip = new TilingSprite({
            texture: textureRegistry.get(TX_PATTERN),
            width: width,
            height: height,
        });
        strip.tileScale.set(PATTERN_SCALE);
        strip.alpha = PATTERN_ALPHA;
        return strip;
    }

    /**
     * Adds a child to the panel body; its (0, 0) is the body's top-left corner after padding.
     * @param {Container} child
     * @returns {void}
     */
    addContent(child) {
        this.content.addChild(child);
    }

    /**
     * Removes all body content (for a rebuild).
     * @returns {void}
     */
    clearContent() {
        for (const child of this.content.removeChildren()) {
            child.destroy({children: true});
        }
    }

    /** @returns {number} width available to content inside the padded body */
    get contentWidth() {
        return this._width - 2 * (BODY_MARGIN + PADDING);
    }

    /**
     * Toggles a 1px outline around each element (chrome and content), for layout debugging.
     * @param {boolean} on
     * @returns {void}
     */
    setDebug(on) {
        if (this._debugOutlines !== null) {
            this._debugOutlines.destroy({children: true});
            this._debugOutlines = null;
        }
        if (!on) {
            return;
        }
        const outlines = debugOutlines(this.children, this);
        this._debugOutlines = outlines;
        this.addChild(outlines);
    }

    /**
     * @returns {void}
     * @private
     */
    _build() {
        // Outer frame: raised border/background spanning the whole panel.
        const bg = this._nineSlice(TX_FRAME, this._width, this._height);
        bg.tint = this._tint;
        // Swallow pointer events so body clicks neither drag nor pass through to the map (mesh-based
        // NineSliceSprite has no default hit bounds, so the hit area is explicit, in unscaled space).
        bg.eventMode = "static";
        bg.hitArea = new Rectangle(0, 0, this._width / FRAME_SCALE, this._height / FRAME_SCALE);
        bg.on("pointerdown", (e) => {
            e.stopPropagation();
            e.nativeEvent.stopPropagation();
            this._raise();
        });
        this.addChild(bg);

        // Inset body below the title row.
        const body = this._nineSlice(TX_FRAME_INSET, this._width - BODY_MARGIN * 2, this._height - TITLE_ROW_HEIGHT - BODY_MARGIN);
        body.x = BODY_MARGIN;
        body.y = TITLE_ROW_HEIGHT;
        body.tint = this._tint;
        this.addChild(body);

        this.addChild(this.content);

        const close = this._buildCloseButton();
        close.x = this._width - PADDING - CLOSE_SIZE;
        close.y = (TITLE_ROW_HEIGHT - CLOSE_SIZE) / 2;

        this.dragHandle = this._buildTitleBar(close.x);
        this.addChild(this.dragHandle);
        this.addChild(close);
    }

    /**
     * Raises this panel above its siblings in the parent.
     * @returns {void}
     * @private
     */
    _raise() {
        if (this.parent !== null) {
            this.parent.addChild(this);
        }
    }

    /**
     * A 9-slice frame at the given on-screen size, its border rendered at FRAME_SCALE.
     * @param {string} name
     * @param {number} width
     * @param {number} height
     * @returns {NineSliceSprite}
     * @private
     */
    _nineSlice(name, width, height) {
        const sprite = new NineSliceSprite({
            texture: this._textureRegistry.get(name),
            leftWidth: FRAME_INSET,
            rightWidth: FRAME_INSET,
            topHeight: FRAME_INSET,
            bottomHeight: FRAME_INSET,
        });
        sprite.width = width / FRAME_SCALE;
        sprite.height = height / FRAME_SCALE;
        sprite.scale.set(FRAME_SCALE);
        return sprite;
    }

    /**
     * The draggable title area: the title text over a transparent hit region, with a decorative
     * pattern filling the space up to the close button.
     * @param {number} closeX - left edge of the close button
     * @returns {Container}
     * @private
     */
    _buildTitleBar(closeX) {
        const handle = new Container();
        handle.hitArea = new Rectangle(0, 0, closeX, TITLE_ROW_HEIGHT);

        const title = new Text({
            text: this._title,
            style: {fontFamily: GAME_FONT, fontSize: TITLE_FONT_SIZE, fill: this._titleColor, fontWeight: "bold"},
        });
        title.x = PADDING;
        title.y = (TITLE_ROW_HEIGHT - title.height) / 2;
        handle.addChild(title);

        // Trailing pattern right-anchored at the close button, snapped to whole tiles.
        const trailingRight = closeX - PATTERN_GAP;
        const trailingWidth = Math.max(Math.floor((trailingRight - title.x - title.width - TITLE_GAP) / PATTERN_TILE) * PATTERN_TILE, 0);
        if (trailingWidth >= PATTERN_TILE) {
            handle.addChild(this._patternStrip(trailingRight - trailingWidth, trailingWidth));
        }

        return handle;
    }

    /**
     * A tiled decorative pattern strip, vertically centered in the title row.
     * @param {number} x
     * @param {number} width
     * @returns {TilingSprite}
     * @private
     */
    _patternStrip(x, width) {
        const strip = new TilingSprite({
            texture: this._textureRegistry.get(TX_PATTERN),
            width: Math.floor(width / PATTERN_TILE) * PATTERN_TILE,
            height: PATTERN_HEIGHT,
        });
        strip.tileScale.set(PATTERN_SCALE);
        strip.alpha = PATTERN_ALPHA;
        strip.x = x;
        strip.y = (TITLE_ROW_HEIGHT - PATTERN_HEIGHT) / 2;
        return strip;
    }

    /**
     * @returns {Sprite}
     * @private
     */
    _buildCloseButton() {
        const button = new Sprite(this._textureRegistry.get(TX_CLOSE));
        button.width = CLOSE_SIZE;
        button.height = CLOSE_SIZE;
        button.eventMode = "static";
        button.cursor = "pointer";
        button.on("pointerdown", (e) => {
            e.stopPropagation();
            e.nativeEvent.stopPropagation();
            if (this._onClose !== null) {
                this._onClose();
            }
        });
        return button;
    }
}
