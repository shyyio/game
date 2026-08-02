import {Container} from "pixi.js";
import {panelText, TextRole} from "@/client/PanelText.js";
import {buildPanelButton, BUTTON_HEIGHT} from "@/client/panelButton.js";
import {UIPanel} from "@/client/UIPanel.js";
import {ScrollView} from "@/client/ScrollView.js";
import {ACTIVE_ACCENT, PANEL_TINT} from "@/client/Theme.js";
import Mobile from "@/client/Mobile.js";

export const ROW_HEIGHT = BUTTON_HEIGHT;
export const ROW_GAP = 6;
const HEADER_HEIGHT = 22;
const SECTION_GAP = 14;
// Clearance between a scroll section's rows and its inset sprite's top/left edges.
const SECTION_PADDING_TOP = 6;
const SECTION_PADDING_LEFT = 6;
const DEFAULT_VISIBLE_ROWS = 5;
// Mobile screens are shorter, so a section's viewport shows fewer rows before scrolling.
const DEFAULT_VISIBLE_ROWS_MOBILE = 3;

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
     * A row-height Container at the current y; `build` fills it, returned as a handle for later mutation.
     * @param {function(Container): void} build
     * @returns {Container}
     */
    row(build) {
        const row = new Container();
        row.y = this._y;
        build(row);
        this.addChild(row);
        this._y += ROW_HEIGHT + ROW_GAP;
        return row;
    }

    /**
     * A label + optional trailing button per item, scrolled past `visibleRows` instead of growing the panel.
     * @param {ClientViewport|null} viewport - frozen against wheel-zoom while a resulting scrollbar is hovered
     * @param {Array} items
     * @param {function(*, number): {label: string, buttonLabel: (string|null), buttonTint: (number|undefined), onClick: (function(): void|null)}} describe
     * @param {string} emptyLabel - shown in place of rows when `items` is empty
     * @param {{visibleRows: number}} [options]
     * @returns {void}
     */
    scrollSection(viewport, items, describe, emptyLabel, {visibleRows} = {}) {
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
        const visibleHeight = Math.min(rowsHeight, viewportHeight);
        const insetHeight = visibleHeight + SECTION_PADDING_TOP;

        const inset = UIPanel.insetSprite(this._textureRegistry, this._contentWidth, insetHeight, PANEL_TINT);
        inset.y = this._y;
        this.addChild(inset);

        if (rowsHeight <= viewportHeight) {
            rows.x = SECTION_PADDING_LEFT;
            rows.y = this._y + SECTION_PADDING_TOP;
            this.addChild(rows);
        } else {
            const scrollView = new ScrollView(viewport, innerWidth, viewportHeight);
            scrollView.x = SECTION_PADDING_LEFT;
            scrollView.y = this._y + SECTION_PADDING_TOP;
            scrollView.content.addChild(rows);
            scrollView.setContentHeight(rowsHeight);
            this.addChild(scrollView);
        }
        this._y += insetHeight;
    }

    /**
     * @private
     * @param {Container} container
     * @param {number} width
     * @param {Array} items
     * @param {function(*, number): {label: string, buttonLabel: (string|null), buttonTint: (number|undefined), onClick: (function(): void|null)}} describe
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
            const {label, buttonLabel, buttonTint, onClick} = describe(item, index);
            const row = new Container();
            row.y = y;
            const text = panelText(label, TextRole.BODY);
            text.y = (ROW_HEIGHT - text.height) / 2;
            row.addChild(text);
            if (buttonLabel !== null && buttonLabel !== undefined) {
                let tint = buttonTint;
                if (tint === undefined) {
                    tint = ACTIVE_ACCENT;
                }
                const button = buildPanelButton(this._textureRegistry, buttonLabel, tint, onClick);
                button.x = width - button.width;
                row.addChild(button);
            }
            container.addChild(row);
            y += ROW_HEIGHT + ROW_GAP;
        }
        return y;
    }
}
