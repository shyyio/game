import {Container} from "pixi.js";
import {BUTTON_HEIGHT as ROW_HEIGHT, ROW_GAP, ROW_INDENT} from "@/client/hud/UiScale.js";
// Re-exported, not copied: a copy would freeze at the scale in force when this module loaded.
export {BUTTON_HEIGHT as ROW_HEIGHT, ROW_GAP, ROW_INDENT} from "@/client/hud/UiScale.js";

/**
 * One row of panel content, laid out rather than hand-placed: items flow in from the left, pin to
 * the right, or take the space left between the two. Anything shorter than the row is centered on
 * it. Nothing is positioned until {@link layout}, so a fill can size itself against items added
 * after it, and the row reports its own {@link overflow} instead of quietly drawing items on top of
 * each other.
 */
export class PanelRow extends Container {

    /**
     * @param {number} width - the content width the row spans
     * @param {number} [height]
     */
    constructor(width, height = ROW_HEIGHT) {
        super();
        this.rowWidth = width;
        this.rowHeight = height;
        this._left = [];
        this._right = [];
        this._fill = null;
        this._overflow = 0;
    }

    /**
     * How far the row's items exceed its width, in pixels; 0 when they fit. A positive value means
     * items are drawn overlapping, which is a layout bug in the panel.
     * @returns {number}
     */
    get overflow() {
        return this._overflow;
    }

    /**
     * Adds `child` to the left-to-right flow.
     * @template {Container} T
     * @param {T} child
     * @param {number} [gap] - the space after this item
     * @returns {T}
     */
    pushLeft(child, gap = ROW_GAP) {
        this._left.push(new RowItem(child, gap));
        this.addChild(child);
        return child;
    }

    /**
     * Adds `child` pinned to the right edge; successive calls stack leftward.
     * @template {Container} T
     * @param {T} child
     * @param {number} [gap] - the space before this item
     * @returns {T}
     */
    pushRight(child, gap = ROW_GAP) {
        this._right.push(new RowItem(child, gap));
        this.addChild(child);
        return child;
    }

    /**
     * Adds `child` in a fixed-width slot, so items after it start at the same x whatever `child`
     * measures; a child wider than its slot counts toward {@link overflow}.
     * @template {Container} T
     * @param {T} child
     * @param {number} width
     * @param {number} [gap] - the space after the slot
     * @returns {T}
     */
    pushColumn(child, width, gap = 0) {
        this._left.push(new RowItem(child, gap, width));
        this.addChild(child);
        return child;
    }

    /**
     * Advances the left-to-right flow by `width` without drawing anything.
     * @param {number} width
     * @returns {void}
     */
    pushSpacer(width) {
        this._left.push(new RowItem(null, 0, width));
    }

    /**
     * Advances the left-to-right flow by one nesting step.
     * @param {number} [steps]
     * @returns {void}
     */
    indent(steps = 1) {
        this.pushSpacer(ROW_INDENT * steps);
    }

    /**
     * Adds the child that takes whatever width the left and right items leave; `build`
     * receives that width and is called during {@link layout}, so it sees every other item.
     * @param {function(number): Container} build
     * @returns {void}
     */
    fill(build) {
        this._fill = build;
    }

    /**
     * Positions every item and computes {@link overflow}.
     * @returns {void}
     */
    layout() {
        const leftWidth = PanelRow._spannedWidth(this._left);
        const rightWidth = PanelRow._spannedWidth(this._right);
        let fillWidth = 0;
        if (this._fill !== null) {
            // Measured before the fill child joins the flow, so its own gaps are counted once.
            const gaps = this._fillGaps();
            const child = this._fill(Math.max(this.rowWidth - leftWidth - rightWidth - gaps, 0));
            this._left.push(new RowItem(child, ROW_GAP));
            this.addChild(child);
            // A fill squeezed to nothing claims no gaps either.
            if (child.width > 0) {
                fillWidth = child.width + gaps;
            }
        }
        this._overflow = Math.max(leftWidth + fillWidth + rightWidth - this.rowWidth, 0);
        for (const item of this._left.concat(this._right)) {
            this._overflow += item.overrun;
        }

        let x = 0;
        for (const item of this._left) {
            item.placeAt(x, this.rowHeight);
            x += item.width + item.gap;
        }
        let right = this.rowWidth;
        for (const item of this._right) {
            item.placeAt(right - item.width, this.rowHeight);
            right -= item.width + item.gap;
        }
    }

    /**
     * The gaps a fill child adds: the one each neighbor declares against it. The left item it
     * follows is the last one added; the right item it runs up against is the leftmost, which is
     * the last one added there too.
     * @private
     * @returns {number}
     */
    _fillGaps() {
        let gaps = 0;
        if (this._left.length > 0) {
            gaps += this._left[this._left.length - 1].gap;
        }
        if (this._right.length > 0) {
            gaps += this._right[this._right.length - 1].gap;
        }
        return gaps;
    }

    /**
     * The width a group spans, the gaps between its items included but not the one after the last.
     * @private
     * @param {RowItem[]} items
     * @returns {number}
     */
    static _spannedWidth(items) {
        let width = 0;
        for (const [index, item] of items.entries()) {
            width += item.width;
            if (index < items.length - 1) {
                width += item.gap;
            }
        }
        return width;
    }
}

/**
 * One item in a row's flow: a display object with the gap beside it, blank width, or a display
 * object held to a fixed slot width.
 */
class RowItem {

    /**
     * @param {Container|null} child - null for blank width
     * @param {number} gap
     * @param {number|null} [width] - a fixed slot width; null takes the child's own
     */
    constructor(child, gap, width = null) {
        this.child = child;
        this.gap = gap;
        this._width = width;
    }

    /**
     * @returns {number} the width the item claims in the flow
     */
    get width() {
        if (this._width !== null) {
            return this._width;
        }
        return this.child.width;
    }

    /**
     * @returns {number} how far the child spills past a fixed slot, 0 when it fits or has none
     */
    get overrun() {
        if (this._width === null || this.child === null) {
            return 0;
        }
        return Math.max(this.child.width - this._width, 0);
    }

    /**
     * Places the item at `x`, centered on a row of `rowHeight`.
     * @param {number} x
     * @param {number} rowHeight
     * @returns {void}
     */
    placeAt(x, rowHeight) {
        if (this.child === null) {
            return;
        }
        this.child.x = x;
        this.child.y = (rowHeight - this.child.height) / 2;
    }
}
