import {Container, Graphics, Rectangle} from "pixi.js";
import {PANEL_BORDER, ACTIVE_ACCENT} from "@/client/Theme.js";
import {trackWindowDrag} from "@/client/layers/pixiUtils.js";

const SCROLLBAR_WIDTH = 6;
const SCROLLBAR_GAP = 4;
const TRACK_ALPHA = 0.15;
const THUMB_ALPHA = 0.6;
const MIN_THUMB_HEIGHT = 24;
// Pointer movement past this before a press-and-move counts as a scroll drag, not a tap on
// whatever's underneath (a row's button, say).
const CONTENT_DRAG_THRESHOLD = 6;

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
     * @param {ClientViewport|null} viewport - frozen against wheel-zoom while the pointer is
     *     over this view, so a scroll doesn't also zoom the map underneath
     * @param {number} width
     * @param {number} height - the visible viewport height; content beyond this scrolls
     */
    constructor(viewport, width, height) {
        super();
        this._viewport = viewport;
        this._width = width;
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

        this._track = new Graphics();
        this._thumb = new Graphics();
        this.addChild(this._track);
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
            this._setScroll(this._scrollY + event.deltaY);
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
                const trackRange = Math.max(this._height - this._thumbHeight(), 1);
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
     * @private
     * @returns {number}
     */
    _thumbHeight() {
        if (this._contentHeight <= this._height) {
            return this._height;
        }
        return Math.max(this._height * (this._height / this._contentHeight), MIN_THUMB_HEIGHT);
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
        this._track.clear();
        this._thumb.clear();
        if (this._contentHeight <= this._height) {
            return;
        }
        const trackX = this._width - SCROLLBAR_WIDTH;
        this._track
            .roundRect(trackX, 0, SCROLLBAR_WIDTH, this._height, SCROLLBAR_WIDTH / 2)
            .fill({color: PANEL_BORDER, alpha: TRACK_ALPHA});

        const thumbHeight = this._thumbHeight();
        const trackRange = Math.max(this._height - thumbHeight, 1);
        const scrollRange = Math.max(this._contentHeight - this._height, 1);
        const thumbY = (this._scrollY / scrollRange) * trackRange;
        this._thumb
            .roundRect(trackX, thumbY, SCROLLBAR_WIDTH, thumbHeight, SCROLLBAR_WIDTH / 2)
            .fill({color: ACTIVE_ACCENT, alpha: THUMB_ALPHA});
    }
}
