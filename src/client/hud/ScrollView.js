import {Container, Graphics, Rectangle} from "pixi.js";
import {SCROLLBAR_TRACK_TINT, ACTIVE_ACCENT} from "@/client/Theme.js";
import {trackWindowDrag} from "@/client/layers/pixiUtils.js";
import {UIPanel} from "@/client/hud/UIPanel.js";

const SCROLLBAR_WIDTH = 14;
const SCROLLBAR_GAP = 4;
// Thumb clearance inside the inset track's border.
const THUMB_INSET = 2;
const THUMB_RADIUS = 3;
const MIN_THUMB_HEIGHT = 24;
// Pointer movement past this before a press-and-move counts as a scroll drag, not a tap on
// whatever's underneath (a row's button, say).
const CONTENT_DRAG_THRESHOLD = 6;
// Pixels per line for line-mode (Firefox) wheel deltas.
const WHEEL_LINE_PIXELS = 16;
// Scales down the large per-notch wheel delta (~120px) for finer steps.
const WHEEL_STEP_SCALE = 0.5;

/**
 * A masked, scrollable viewport with a draggable vertical scrollbar; the bar draws (and scrolling
 * does anything) only once content exceeds the viewport height. The host adds children to
 * {@link ScrollView#content} at their natural positions, then calls {@link setContentHeight}.
 */
export class ScrollView extends Container {

    /**
     * The content width left over once a viewport of `width` reserves its scrollbar gutter (for
     * sizing content consistently whether or not the bar ends up drawn).
     * @param {number} width
     * @returns {number}
     */
    static contentWidthFor(width) {
        return width - SCROLLBAR_WIDTH - SCROLLBAR_GAP;
    }

    /**
     * @param {TextureRegistry} textureRegistry
     * @param {ClientViewport|null} viewport - frozen against wheel-zoom while the pointer is
     *     over this view, so a scroll doesn't also zoom the map underneath
     * @param {number} width
     * @param {number} height - the visible viewport height; content beyond this scrolls
     */
    constructor(
        textureRegistry,
        viewport,
        width,
        height,
    ) {
        super();
        this._viewport = viewport;
        this._height = height;
        this._contentHeight = 0;
        this._scrollY = 0;
        // Touch/mouse drag directly on the content (not the scrollbar thumb) — the primary way
        // to scroll on mobile, where there's no wheel and the thumb is too thin to grab reliably.
        this._contentDragStartY = null;
        this._contentDragStartScroll = null;
        this._contentDragging = false;

        this.content = new Container();
        this.addChild(this.content);

        const maskGraphics = new Graphics().rect(0, 0, width, height).fill({color: 0xffffff});
        this.addChild(maskGraphics);
        this.mask = maskGraphics;

        const trackX = width - SCROLLBAR_WIDTH;
        this._track = UIPanel.insetSprite(textureRegistry, SCROLLBAR_WIDTH, height, SCROLLBAR_TRACK_TINT);
        this._track.x = trackX;
        this.addChild(this._track);
        this._thumb = new Graphics();
        this._thumb.x = trackX + THUMB_INSET;
        this.addChild(this._thumb);

        this.eventMode = "static";
        this.hitArea = new Rectangle(0, 0, width, height);
        // Freezing the viewport's own wheel-zoom plugin while hovered is the same mechanism
        // EffectiveToolController already uses for pan (freezePan/unfreezePan); pixi-viewport
        // listens for "wheel" as a raw DOM listener on the canvas, bypassing pixi's hit-testing
        // entirely, so there's no way to shadow it through pixi's own event system.
        if (this._viewport !== null) {
            this.on("pointerover", () => this._viewport.freezeZoom());
            this.on("pointerout", () => this._viewport.unfreezeZoom());
        }
        this.on("wheel", (event) => {
            if (this._contentHeight <= this._height) {
                return;
            }
            event.preventDefault();
            this._setScroll(this._scrollY + this._wheelDeltaPixels(event) * WHEEL_STEP_SCALE);
        });

        this.on("pointerdown", (event) => {
            if (this._contentHeight <= this._height) {
                return;
            }
            this._contentDragStartY = event.global.y;
            this._contentDragStartScroll = this._scrollY;
            this._contentDragging = false;
        });
        this.on("globalpointermove", (event) => {
            if (this._contentDragStartY === null) {
                return;
            }
            const deltaY = event.global.y - this._contentDragStartY;
            if (!this._contentDragging && Math.abs(deltaY) < CONTENT_DRAG_THRESHOLD) {
                return;
            }
            // Past the threshold: a real drag, not a tap on a row's button underneath.
            this._contentDragging = true;
            this._setScroll(this._contentDragStartScroll - deltaY);
        });
        const endContentDrag = () => {
            this._contentDragStartY = null;
            this._contentDragging = false;
        };
        this.on("pointerup", endContentDrag);
        this.on("pointerupoutside", endContentDrag);
        this.on("pointercancel", endContentDrag);

        this._thumb.eventMode = "static";
        this._thumb.cursor = "pointer";
        this._thumb.on("pointerdown", (event) => {
            event.stopPropagation();
            event.nativeEvent.stopPropagation();
            const startScroll = this._scrollY;
            trackWindowDrag(event.nativeEvent, (deltaX, deltaY) => {
                const trackRange = Math.max(this._trackHeight() - this._thumbHeight(), 1);
                const scrollRange = Math.max(this._contentHeight - this._height, 0);
                this._setScroll(startScroll + deltaY * (scrollRange / trackRange));
            });
        });

        this._render();
    }

    /**
     * Sets the scrollable content's total height (its width is the host's concern) and clamps the
     * current scroll to it; call after populating {@link content}.
     * @param {number} contentHeight
     * @returns {void}
     */
    setContentHeight(contentHeight) {
        this._contentHeight = contentHeight;
        this._setScroll(this._scrollY);
    }

    /**
     * @returns {number}
     */
    get scrollY() {
        return this._scrollY;
    }

    /**
     * Clamped to the content; a host carries the offset across a rebuild with it.
     * @param {number} value
     */
    set scrollY(value) {
        this._setScroll(value);
    }

    /**
     * Unfreezes wheel-zoom if this is torn down while the pointer is still over it (a rebuild
     * mid-hover, say), so the viewport is never left stuck ignoring the wheel.
     * @param {object} [options]
     * @returns {void}
     */
    destroy(options) {
        if (this._viewport !== null) {
            this._viewport.unfreezeZoom();
        }
        super.destroy(options);
    }

    /**
     * The wheel delta in pixels, whatever the event's native unit.
     * @private
     * @param {FederatedWheelEvent} event
     * @returns {number}
     */
    _wheelDeltaPixels(event) {
        if (event.deltaMode === event.DOM_DELTA_LINE) {
            return event.deltaY * WHEEL_LINE_PIXELS;
        }
        if (event.deltaMode === event.DOM_DELTA_PAGE) {
            return event.deltaY * this._height;
        }
        return event.deltaY;
    }

    /**
     * The track's inner (thumb-travel) height, inside the frame insets.
     * @private
     * @returns {number}
     */
    _trackHeight() {
        return this._height - THUMB_INSET * 2;
    }

    /**
     * @private
     * @returns {number}
     */
    _thumbHeight() {
        if (this._contentHeight <= this._height) {
            return this._trackHeight();
        }
        return Math.max(this._trackHeight() * (this._height / this._contentHeight), MIN_THUMB_HEIGHT);
    }

    /**
     * @private
     * @param {number} value
     * @returns {void}
     */
    _setScroll(value) {
        const maxScroll = Math.max(this._contentHeight - this._height, 0);
        this._scrollY = Math.min(Math.max(value, 0), maxScroll);
        this.content.y = -this._scrollY;
        this._render();
    }

    /**
     * @private
     * @returns {void}
     */
    _render() {
        const overflowing = this._contentHeight > this._height;
        this._track.visible = overflowing;
        this._thumb.visible = overflowing;
        this._thumb.clear();
        if (!overflowing) {
            return;
        }
        const thumbHeight = this._thumbHeight();
        const trackRange = Math.max(this._trackHeight() - thumbHeight, 1);
        const scrollRange = Math.max(this._contentHeight - this._height, 1);
        this._thumb
            .roundRect(0, 0, SCROLLBAR_WIDTH - THUMB_INSET * 2, thumbHeight, THUMB_RADIUS)
            .fill(ACTIVE_ACCENT);
        this._thumb.y = THUMB_INSET + (this._scrollY / scrollRange) * trackRange;
    }
}
