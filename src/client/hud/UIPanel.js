import {Container, Sprite, Text, NineSliceSprite, TilingSprite, Rectangle} from "pixi.js";
import {GAME_FONT} from "@/client/constants.js";
import {swallowClicks, trackTap, trackWindowDrag} from "@/client/layers/pixiUtils.js";
import {PanelStack} from "@/client/hud/PanelStack.js";
import {CLOSE_SIZE} from "@/client/hud/UiScale.js";
import Mobile from "@/client/Mobile.js";

const TITLE_ROW_HEIGHT = 40;
const PADDING = 8;
const SCREEN_MARGIN = 12;
// On touch the on-screen keyboard covers the lower screen, so panels sit in the top third.
const KEYBOARD_CLEAR_FRACTION = 1 / 3;
// Gap between the outer frame and the inset body, so the outer border shows around it.
const BODY_MARGIN = 8;
const TITLE_FONT_SIZE = 18;
// Close button icon shrinks to this fraction of its size while pressed.
const CLOSE_PRESS_SCALE = 0.9;

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
 * A framed HUD panel: raised outer frame + sunken inset body + draggable title bar with a close button.
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
        // Same 9-slice frame as the panel, so the shadow matches its shape.
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
        const originX = this.x;
        const originY = this.y;
        const screen = this._app.screen;
        trackWindowDrag(event, (deltaX, deltaY) => {
            const maxX = screen.width - EDGE_MARGIN - this._width;
            const maxY = screen.height - EDGE_MARGIN - this._height;
            this.x = Math.min(Math.max(originX + deltaX, EDGE_MARGIN), maxX);
            this.y = Math.min(Math.max(originY + deltaY, EDGE_MARGIN), maxY);
        });
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
     * The content width available inside a panel of the given outer width, before it exists (for
     * sizing content ahead of construction).
     * @param {number} width
     * @returns {number}
     */
    static contentWidthFor(width) {
        return width - 2 * (BODY_MARGIN + PADDING);
    }

    /**
     * The panel's raised outer frame as a standalone tinted 9-slice sprite, with a hit area set.
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
     * The panel's sunken inset body as a standalone tinted 9-slice sprite.
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
     * A standalone tiled decorative pattern rectangle, matching the title bar's strip.
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
     * Default `position` fallback for {@link UIPanel.managed}/{@link ManagedPanel#show}: centered on screen.
     * @param {Application} app
     * @param {number} width
     * @returns {function(height: number): {x: number, y: number}}
     */
    static centerPosition(app, width) {
        return (height) => ({
            x: (app.screen.width - width) / 2,
            y: clamp((app.screen.height - height) / 2, SCREEN_MARGIN, UIPanel.maxTop(app, height)),
        });
    }

    /**
     * The lowest a panel's top may sit: clear of the on-screen keyboard on touch, clear of the
     * bottom edge otherwise.
     * @param {Application} app
     * @param {number} height
     * @returns {number}
     */
    static maxTop(app, height) {
        if (Mobile.enabled) {
            return app.screen.height * KEYBOARD_CLEAR_FRACTION - height;
        }
        return app.screen.height - height - SCREEN_MARGIN;
    }

    /**
     * Rebuilds a content-sized frame+inset pair (compact HUD boxes like NoticeLayer/StatusMessageLayer,
     * not a full draggable {@link UIPanel}); inset is inset by `frameMargin` on every side.
     * @param {Container} container
     * @param {{frame: NineSliceSprite|null, inset: NineSliceSprite|null}} previous
     * @param {TextureRegistry} textureRegistry
     * @param {number} width
     * @param {number} height
     * @param {number} tint
     * @param {number} frameMargin
     * @returns {{frame: NineSliceSprite, inset: NineSliceSprite}}
     */
    static rebuildFramedBox(container, previous, textureRegistry, width, height, tint, frameMargin) {
        const inset = UIPanel.rebuildInset(container, previous.inset, textureRegistry,
            width - frameMargin * 2, height - frameMargin * 2, tint, {x: frameMargin, y: frameMargin});
        const frame = UIPanel.rebuildFrame(container, previous.frame, textureRegistry, width, height, tint);
        return {frame, inset};
    }

    /**
     * Replaces `previous` (destroyed if given) with a fresh {@link UIPanel.frameSprite} at index 0; call last so it ends up behind everything else.
     * @param {Container} container
     * @param {NineSliceSprite|null} previous
     * @param {TextureRegistry} textureRegistry
     * @param {number} width
     * @param {number} height
     * @param {number} tint
     * @param {{x: number, y: number}} [position]
     * @returns {NineSliceSprite}
     */
    static rebuildFrame(container, previous, textureRegistry, width, height, tint, position = {x: 0, y: 0}) {
        return UIPanel._rebuildSprite(container, previous,
            () => UIPanel.frameSprite(textureRegistry, width, height, tint), position, 0);
    }

    /**
     * Replaces `previous` (destroyed if given) with a fresh {@link UIPanel.insetSprite} at index 0; call before {@link UIPanel.rebuildFrame}.
     * @param {Container} container
     * @param {NineSliceSprite|null} previous
     * @param {TextureRegistry} textureRegistry
     * @param {number} width
     * @param {number} height
     * @param {number} tint
     * @param {{x: number, y: number}} [position]
     * @returns {NineSliceSprite}
     */
    static rebuildInset(container, previous, textureRegistry, width, height, tint, position = {x: 0, y: 0}) {
        return UIPanel._rebuildSprite(container, previous,
            () => UIPanel.insetSprite(textureRegistry, width, height, tint), position, 0);
    }

    /**
     * Shared "destroy previous, build fresh, position, insert" step for the rebuild* helpers.
     * @private
     * @param {Container} container
     * @param {Container|null} previous
     * @param {function(): Container} factory
     * @param {{x: number, y: number}} position
     * @param {number} index
     * @returns {Container}
     */
    static _rebuildSprite(container, previous, factory, position, index) {
        if (previous !== null) {
            previous.destroy();
        }
        const sprite = factory();
        sprite.position.set(position.x, position.y);
        container.addChildAt(sprite, index);
        return sprite;
    }

    /**
     * Builds (or rebuilds) a panel from declarative content: `buildBody` fills a {@link PanelStack} that sizes the panel's height.
     * @param {UIPanel|null} previous
     * @param {object} options
     * @param {Application} options.app
     * @param {TextureRegistry} options.textureRegistry
     * @param {string} options.title
     * @param {number} options.titleColor
     * @param {number} options.tint
     * @param {number} options.width
     * @param {function(): void} [options.onClose]
     * @param {function(height: number): {x: number, y: number}} options.position
     * @param {function(PanelStack): void} buildBody
     * @returns {UIPanel}
     */
    static managed(previous, options, buildBody) {
        const stack = new PanelStack(options.textureRegistry, UIPanel.contentWidthFor(options.width));
        buildBody(stack);
        if (stack.overflow > 0) {
            throw new Error(`Panel "${options.title}" has a row overflowing by ${stack.overflow}px`);
        }

        const height = UIPanel.heightForContent(stack.contentHeight);
        let x;
        let y;
        if (previous !== null) {
            x = previous.x;
            y = previous.y;
            previous.destroy({children: true});
        } else {
            ({x, y} = options.position(height));
        }

        const panel = new UIPanel({
            app: options.app,
            textureRegistry: options.textureRegistry,
            title: options.title,
            titleColor: options.titleColor,
            tint: options.tint,
            width: options.width,
            height: height,
            onClose: options.onClose,
        });
        panel.x = x;
        panel.y = y;
        panel.addContent(stack);
        return panel;
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
        return UIPanel.contentWidthFor(this._width);
    }

    /**
     * The panel's outer width; named `outerWidth` to avoid shadowing {@link Container#width}.
     * @returns {number}
     */
    get outerWidth() {
        return this._width;
    }

    /**
     * The panel's outer height; named `outerHeight` for the same reason as {@link UIPanel#outerWidth}.
     * @returns {number}
     */
    get outerHeight() {
        return this._height;
    }

    /**
     * Repaints the frame and title for a new palette; the body's content belongs to the owner, which
     * rebuilds it separately.
     * @param {number} tint
     * @param {number} titleColor
     * @returns {void}
     */
    restyle(tint, titleColor) {
        this._tint = tint;
        this._titleColor = titleColor;
        this._frameSprite.tint = tint;
        this._bodySprite.tint = tint;
        this._titleText.style.fill = titleColor;
    }

    /**
     * @returns {void}
     * @private
     */
    _build() {
        // Outer frame: raised border/background spanning the whole panel.
        const bg = this._nineSlice(TX_FRAME, this._width, this._height);
        bg.tint = this._tint;
        this._frameSprite = bg;
        // Swallows clicks so they don't pass through to the map; explicit hit area (mesh sprite has none by default).
        bg.hitArea = new Rectangle(0, 0, this._width / FRAME_SCALE, this._height / FRAME_SCALE);
        swallowClicks(bg, {native: true});
        bg.on("pointerdown", () => this._raise());
        this.addChild(bg);

        // Inset body below the title row.
        const body = this._nineSlice(TX_FRAME_INSET, this._width - BODY_MARGIN * 2, this._height - TITLE_ROW_HEIGHT - BODY_MARGIN);
        body.x = BODY_MARGIN;
        body.y = TITLE_ROW_HEIGHT;
        body.tint = this._tint;
        this._bodySprite = body;
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
        this._titleText = title;
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
     * @returns {Container}
     * @private
     */
    _buildCloseButton() {
        const button = new Container();
        button.cursor = "pointer";

        // Anchored/positioned to its own center so it can shrink in place; the container itself
        // stays unscaled, since callers position it (and read `.x`) by its top-left corner.
        const icon = new Sprite(this._textureRegistry.get(TX_CLOSE));
        icon.width = CLOSE_SIZE;
        icon.height = CLOSE_SIZE;
        const baseScale = {x: icon.scale.x, y: icon.scale.y};
        icon.anchor = 0.5;
        icon.position.set(CLOSE_SIZE / 2, CLOSE_SIZE / 2);
        button.addChild(icon);

        button.on("pointerover", () => icon.tint = 0xEEEEEE);
        button.on("pointerout", () => {
            icon.tint = 0xffffff;
            icon.scale.set(baseScale.x, baseScale.y);
        });
        button.on("pointerdown", () => icon.scale.set(baseScale.x * CLOSE_PRESS_SCALE, baseScale.y * CLOSE_PRESS_SCALE));
        button.on("pointerup", () => icon.scale.set(baseScale.x, baseScale.y));
        button.on("pointerupoutside", () => icon.scale.set(baseScale.x, baseScale.y));
        trackTap(button, () => {
            if (this._onClose !== null) {
                this._onClose();
            }
        }, {stopNativePropagation: true});
        return button;
    }
}

/**
 * Owns a {@link UIPanel} across hide/show cycles, remembering the dragged position between them.
 */
export class ManagedPanel {

    constructor() {
        this.panel = null;
        this._savedX = null;
        this._savedY = null;
    }

    /**
     * Builds (or rebuilds, keeping the dragged position) the panel via {@link UIPanel.managed}.
     * @param {object} options - same as {@link UIPanel.managed}'s `options`, minus `position`
     * @param {function(height: number): {x: number, y: number}} fallback - position when nothing's remembered yet
     * @param {function(PanelStack): void} buildBody
     * @returns {UIPanel}
     */
    show(options, fallback, buildBody) {
        const position = (height) => {
            if (this._savedX !== null) {
                return {x: this._savedX, y: this._savedY};
            }
            return fallback(height);
        };
        this.panel = UIPanel.managed(this.panel, {...options, position}, buildBody);
        return this.panel;
    }

    /**
     * Drops the remembered position, so the next show falls back to its own placement — for a panel
     * whose target changed under it.
     * @returns {void}
     */
    forgetPosition() {
        this._savedX = null;
        this._savedY = null;
    }

    /**
     * Remembers the dragged position and destroys the panel; a no-op while already hidden.
     * @returns {void}
     */
    hide() {
        if (this.panel === null) {
            return;
        }
        this._savedX = this.panel.x;
        this._savedY = this.panel.y;
        this.panel.destroy({children: true});
        this.panel = null;
    }
}

/**
 * `value` held between the bounds; an inverted range (a panel taller than its allowance) collapses
 * to `low`, so it top-aligns instead of hanging off the top edge.
 * @param {number} value
 * @param {number} low
 * @param {number} high
 * @returns {number}
 */
function clamp(value, low, high) {
    return Math.min(Math.max(value, low), Math.max(low, high));
}
