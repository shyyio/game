import {Container, Graphics, Rectangle} from "pixi.js";
import {panelText, TextRole} from "@/client/hud/PanelText.js";
import {buildPanelButton} from "@/client/hud/panelButton.js";
import {PanelRow, ROW_HEIGHT, ROW_GAP} from "@/client/hud/PanelRow.js";
import {trackTap} from "@/client/layers/pixiUtils.js";
import {UIPanel} from "@/client/hud/UIPanel.js";
import {ScrollView} from "@/client/hud/ScrollView.js";
import {ACTIVE_ACCENT, PANEL_TINT} from "@/client/Theme.js";
import Mobile from "@/client/Mobile.js";

const HEADER_HEIGHT = 22;
const SECTION_GAP = 14;
// Clearance between a scroll section's rows and its inset sprite's top/left edges.
const SECTION_PADDING_TOP = 6;
const SECTION_PADDING_LEFT = 6;
const DEFAULT_VISIBLE_ROWS = 5;
// Mobile screens are shorter, so a section's viewport shows fewer rows before scrolling.
const DEFAULT_VISIBLE_ROWS_MOBILE = 3;
const SWATCH_SIZE = 14;
const SWATCH_RADIUS = 3;
const SWATCH_GAP = 8;
const SELECTED_RADIUS = 4;
const SELECTED_ALPHA = 0.25;

/**
 * Declarative panel-body builder: appends header/text/row/scrollSection content top to bottom.
 */
export class PanelStack extends Container {

    /**
     * @param {TextureRegistry} textureRegistry
     * @param {number} contentWidth - the width available inside the panel this stack will be added to
     */
    constructor(textureRegistry, contentWidth) {
        super();
        this._textureRegistry = textureRegistry;
        this._contentWidth = contentWidth;
        this._y = 0;
        this._overflow = 0;
    }

    /** @returns {number} width available inside the panel */
    get contentWidth() {
        return this._contentWidth;
    }

    /** @returns {number} total content height so far */
    get contentHeight() {
        return this._y;
    }

    /**
     * The worst overflow among the rows built so far, in pixels; anything above 0 means a row draws
     * its items on top of each other.
     * @returns {number}
     */
    get overflow() {
        return this._overflow;
    }

    /**
     * A bold section header.
     * @param {string} label
     * @returns {void}
     */
    header(label) {
        const text = panelText(label, TextRole.HEADER);
        text.y = this._y;
        this.addChild(text);
        this._y += HEADER_HEIGHT;
    }

    /**
     * A single line of body text.
     * @param {string} label
     * @param {string} [role] - a TextRole value
     * @returns {Text}
     */
    text(label, role = TextRole.BODY) {
        const text = panelText(label, role);
        text.y = this._y;
        this.addChild(text);
        this._y += ROW_HEIGHT;
        return text;
    }

    /**
     * Vertical space between sections.
     * @returns {void}
     */
    gap() {
        this._y += SECTION_GAP;
    }

    /**
     * Appends a pre-built container of the given height at the current y.
     * @param {Container} container
     * @param {number} height
     * @returns {void}
     */
    block(container, height) {
        container.y = this._y;
        this.addChild(container);
        this._y += height;
    }

    /**
     * A row at the current y; `build` fills it through the row's leading/trailing/fill slots,
     * returned as a handle for later mutation.
     * @param {function(PanelRow): void} build
     * @returns {PanelRow}
     */
    row(build) {
        const row = new PanelRow(this._contentWidth);
        row.y = this._y;
        build(row);
        row.layout();
        this._overflow = Math.max(this._overflow, row.overflow);
        this.addChild(row);
        this._y += ROW_HEIGHT + ROW_GAP;
        return row;
    }

    /**
     * A row per item — swatch/label/trailing text and per-row or trailing-button actions —
     * scrolled past `visibleRows` instead of growing the panel.
     * @param {ClientViewport|null} viewport - frozen against wheel-zoom while a resulting scrollbar is hovered
     * @param {Array} items
     * @param {function(*, number): PanelRowDescriptor} describe
     * @param {string} emptyLabel - shown in place of rows when `items` is empty
     * @param {{visibleRows: number, fixedHeight: boolean}} [options] - fixedHeight keeps the
     *     section at `visibleRows` tall regardless of item count, so the row set can change later
     * @returns {ScrollSectionHandle|null} an update handle for a fixedHeight section, null otherwise
     */
    scrollSection(viewport, items, describe, emptyLabel, {visibleRows, fixedHeight = false} = {}) {
        const innerWidth = this._contentWidth - SECTION_PADDING_LEFT;
        // Always built at scrollbar-reserved width, so a short list never reflows crossing the threshold.
        const rowsWidth = ScrollView.contentWidthFor(innerWidth);
        const rows = new Container();
        const rowsHeight = this._buildRows(rows, rowsWidth, items, describe, emptyLabel);

        let maxRows = visibleRows;
        if (maxRows === undefined) {
            if (Mobile.enabled) {
                maxRows = DEFAULT_VISIBLE_ROWS_MOBILE;
            } else {
                maxRows = DEFAULT_VISIBLE_ROWS;
            }
        }
        const viewportHeight = maxRows * (ROW_HEIGHT + ROW_GAP) - ROW_GAP;
        let visibleHeight = viewportHeight;
        if (!fixedHeight) {
            visibleHeight = Math.min(rowsHeight, viewportHeight);
        }
        const insetHeight = visibleHeight + SECTION_PADDING_TOP;

        const inset = UIPanel.insetSprite(this._textureRegistry, this._contentWidth, insetHeight, PANEL_TINT);
        inset.y = this._y;
        this.addChild(inset);

        if (fixedHeight) {
            // Always a ScrollView: the row set can grow past the viewport after later updates.
            const scrollView = this._buildScrollView(viewport, innerWidth, viewportHeight, rows, rowsHeight);
            this.addChild(scrollView);
            this._y += insetHeight;
            return new ScrollSectionHandle(scrollView, (container, nextItems) =>
                this._buildRows(container, rowsWidth, nextItems, describe, emptyLabel));
        }

        if (rowsHeight <= viewportHeight) {
            rows.x = SECTION_PADDING_LEFT;
            rows.y = this._y + SECTION_PADDING_TOP;
            this.addChild(rows);
        } else {
            this.addChild(this._buildScrollView(viewport, innerWidth, viewportHeight, rows, rowsHeight));
        }
        this._y += insetHeight;
        return null;
    }

    /**
     * A section's ScrollView, spanning the full inset height so the scrollbar runs edge to edge;
     * the rows keep their top clearance inside the scrolled content instead.
     * @private
     * @param {ClientViewport|null} viewport
     * @param {number} innerWidth
     * @param {number} viewportHeight
     * @param {Container} rows
     * @param {number} rowsHeight
     * @returns {ScrollView}
     */
    _buildScrollView(viewport, innerWidth, viewportHeight, rows, rowsHeight) {
        const scrollView = new ScrollView(
            this._textureRegistry,
            viewport,
            innerWidth,
            viewportHeight + SECTION_PADDING_TOP,
        );
        scrollView.x = SECTION_PADDING_LEFT;
        scrollView.y = this._y;
        rows.y = SECTION_PADDING_TOP;
        scrollView.content.addChild(rows);
        scrollView.setContentHeight(rowsHeight + SECTION_PADDING_TOP);
        return scrollView;
    }

    /**
     * @private
     * @param {Container} container
     * @param {number} width
     * @param {Array} items
     * @param {function(*, number): PanelRowDescriptor} describe
     * @param {string} emptyLabel
     * @returns {number} the built rows' total height
     */
    _buildRows(container, width, items, describe, emptyLabel) {
        if (items.length === 0) {
            const empty = panelText(emptyLabel, TextRole.MUTED);
            empty.y = (ROW_HEIGHT - empty.height) / 2;
            container.addChild(empty);
            return ROW_HEIGHT;
        }
        let y = 0;
        for (const [index, item] of items.entries()) {
            const descriptor = describe(item, index);
            const row = new PanelRow(width);
            row.y = y;
            if (descriptor.selected === true) {
                // Behind the flow, spanning the row, so it is drawn rather than laid out.
                row.addChild(new Graphics()
                    .roundRect(0, 0, width, ROW_HEIGHT, SELECTED_RADIUS)
                    .fill({color: ACTIVE_ACCENT, alpha: SELECTED_ALPHA}));
            }
            if (descriptor.swatchColor !== undefined) {
                row.leading(new Graphics()
                    .roundRect(0, 0, SWATCH_SIZE, SWATCH_SIZE, SWATCH_RADIUS)
                    .fill(descriptor.swatchColor), SWATCH_GAP);
            }
            row.leading(panelText(descriptor.label, TextRole.BODY));
            if (descriptor.trailingLabel !== undefined) {
                row.trailing(panelText(descriptor.trailingLabel, TextRole.BODY));
            }
            if (descriptor.buttonLabel !== null && descriptor.buttonLabel !== undefined) {
                let tint = descriptor.buttonTint;
                if (tint === undefined) {
                    tint = ACTIVE_ACCENT;
                }
                row.trailing(buildPanelButton(this._textureRegistry, descriptor.buttonLabel, tint, descriptor.onClick));
            }
            row.layout();
            this._overflow = Math.max(this._overflow, row.overflow);
            if (descriptor.onRowClick !== undefined) {
                this._wireRowTap(row, width, descriptor.onRowClick);
            }
            container.addChild(row);
            y += ROW_HEIGHT + ROW_GAP;
        }
        return y;
    }

    /**
     * Row-wide tap wiring; propagation is left alone, so a scroll drag starting on the row still
     * scrolls it.
     * @private
     * @param {Container} row
     * @param {number} width
     * @param {function(): void} onRowClick
     * @returns {void}
     */
    _wireRowTap(row, width, onRowClick) {
        row.cursor = "pointer";
        row.hitArea = new Rectangle(0, 0, width, ROW_HEIGHT);
        trackTap(row, onRowClick, {stopPropagation: false});
    }
}

/**
 * One scrollSection row's content and actions.
 */
export class PanelRowDescriptor {

    /**
     * @param {object} fields
     * @param {string} fields.label
     * @param {number} [fields.swatchColor] leading color swatch
     * @param {string} [fields.trailingLabel] right-aligned text (not combined with a button)
     * @param {boolean} [fields.selected] accent row background
     * @param {function(): void} [fields.onRowClick] fired on a tap anywhere on the row
     * @param {string} [fields.buttonLabel] trailing button
     * @param {number} [fields.buttonTint]
     * @param {function(): void} [fields.onClick] fired by the trailing button
     */
    constructor({label, swatchColor, trailingLabel, selected, onRowClick, buttonLabel, buttonTint, onClick}) {
        this.label = label;
        this.swatchColor = swatchColor;
        this.trailingLabel = trailingLabel;
        this.selected = selected;
        this.onRowClick = onRowClick;
        this.buttonLabel = buttonLabel;
        this.buttonTint = buttonTint;
        this.onClick = onClick;
    }
}

/**
 * Handle to a fixedHeight scrollSection: swaps the row set in place, keeping the inset and
 * scroll machinery (and scroll position, clamped) alive.
 */
export class ScrollSectionHandle {

    /**
     * @param {ScrollView} scrollView
     * @param {function(Container, Array): number} buildRows fills a container, returns its height
     */
    constructor(
        scrollView,
        buildRows,
    ) {
        this._scrollView = scrollView;
        this._buildRows = buildRows;
        this._rows = null;
    }

    /**
     * @param {Array} items
     * @returns {void}
     */
    update(items) {
        if (this._rows !== null) {
            this._rows.destroy({children: true});
        } else {
            // The initial rows were built by scrollSection itself.
            for (const child of this._scrollView.content.removeChildren()) {
                child.destroy({children: true});
            }
        }
        this._rows = new Container();
        const height = this._buildRows(this._rows, items);
        this._rows.y = SECTION_PADDING_TOP;
        this._scrollView.content.addChild(this._rows);
        this._scrollView.setContentHeight(height + SECTION_PADDING_TOP);
    }
}
