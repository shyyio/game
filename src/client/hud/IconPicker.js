import {Container, Graphics, Rectangle, Sprite, Text} from "pixi.js";
import {ScrollView} from "@/client/hud/ScrollView.js";
import {UIPanel} from "@/client/hud/UIPanel.js";
import {PANEL_TINT, ACTIVE_ACCENT} from "@/client/Theme.js";
import {fitIcon, trackTap} from "@/client/layers/pixiUtils.js";
import {ICON_CELL_SIZE as CELL_SIZE} from "@/client/hud/UiScale.js";
import {GAME_FONT} from "@/client/constants.js";

const CELL_GAP = 4;
const ICON_INSET = 6;
const PADDING = 6;
const SELECTED_ALPHA = 0.35;
const HOVER_ALPHA = 0.15;
const DEFAULT_COLUMNS = 6;
const DEFAULT_VISIBLE_ROWS = 4;
const LABEL_SIZE = 15;
const LABEL_INSET = 2;
// The label reads over any icon: white on a black outline, rounded so glyph corners stay flat.
const LABEL_COLOR = 0xFFFFFF;
const LABEL_STROKE = {color: 0x000000, width: 2, join: "round"};

/**
 * One pickable icon.
 */
export class IconPickerEntry {

    /**
     * @param {number} id
     * @param {string} textureName
     * @param {object} [options]
     * @param {number} [options.tint]
     * @param {string} [options.label] short text in the cell's bottom-right corner, e.g. a count
     * @param {string} [options.tooltipText] what a HoverTooltip pointed at the cell shows
     */
    constructor(id, textureName, {tint = 0xffffff, label = "", tooltipText = ""} = {}) {
        this.id = id;
        this.textureName = textureName;
        this.tint = tint;
        this.label = label;
        this.tooltipText = tooltipText;
    }
}

/**
 * A scrollable grid of tappable icons over an inset background; scales to hundreds of entries.
 * Generic: item choosers, marker-icon choosers, anything picked by sight.
 */
export class IconPicker extends Container {

    /**
     * @param {TextureRegistry} textureRegistry
     * @param {number} width
     * @param {IconPickerEntry[]} entries
     * @param {function(number): void} onPick - receives the picked entry's id
     * @param {object} [options]
     * @param {number} [options.columns]
     * @param {number} [options.visibleRows]
     * @param {number|null} [options.selectedId]
     * @param {number} [options.cellSize]
     * @param {function(number|null, Container): void|null} [options.onHover] - the hovered entry's
     *     id (null on leave) and its cell, which carries the entry's tooltipText
     */
    constructor(
        textureRegistry,
        width,
        entries,
        onPick,
        {
            columns = DEFAULT_COLUMNS,
            visibleRows = DEFAULT_VISIBLE_ROWS,
            selectedId = null,
            cellSize = CELL_SIZE,
            onHover = null,
        } = {},
    ) {
        super();
        const rows = Math.ceil(entries.length / columns);
        const contentHeight = rows * (cellSize + CELL_GAP) - CELL_GAP + PADDING * 2;
        const viewportHeight = Math.min(
            contentHeight,
            visibleRows * (cellSize + CELL_GAP) - CELL_GAP + PADDING * 2,
        );
        this.pickerHeight = viewportHeight;

        this.addChild(UIPanel.insetSprite(textureRegistry, width, viewportHeight, PANEL_TINT));

        const grid = new Container();
        for (const [index, entry] of entries.entries()) {
            const cell = this._buildCell(textureRegistry, entry, entry.id === selectedId, onPick, cellSize, onHover);
            cell.x = PADDING + (index % columns) * (cellSize + CELL_GAP);
            cell.y = PADDING + Math.floor(index / columns) * (cellSize + CELL_GAP);
            grid.addChild(cell);
        }

        if (contentHeight <= viewportHeight) {
            this.addChild(grid);
            return;
        }
        const scrollView = new ScrollView(textureRegistry, width, viewportHeight);
        scrollView.content.addChild(grid);
        scrollView.setContentHeight(contentHeight);
        this.addChild(scrollView);
    }

    /**
     * How many columns fit a picker of the given width.
     * @param {number} width
     * @param {number} [cellSize]
     * @returns {number}
     */
    static columnsFor(width, cellSize = CELL_SIZE) {
        return Math.max(1, Math.floor((width - PADDING * 2 + CELL_GAP) / (cellSize + CELL_GAP)));
    }

    /**
     * One icon cell: highlight backdrop, scaled tinted sprite, drag-tolerant tap.
     * @private
     * @param {TextureRegistry} textureRegistry
     * @param {IconPickerEntry} entry
     * @param {boolean} selected
     * @param {function(number): void} onPick
     * @param {number} cellSize
     * @param {function(number|null, Container): void|null} onHover
     * @returns {Container}
     */
    _buildCell(textureRegistry, entry, selected, onPick, cellSize, onHover) {
        const cell = new Container();
        cell.tooltipText = entry.tooltipText;
        const backdrop = new Graphics().roundRect(0, 0, cellSize, cellSize, 4).fill(ACTIVE_ACCENT);
        if (selected) {
            backdrop.alpha = SELECTED_ALPHA;
        } else {
            backdrop.alpha = 0;
        }
        cell.addChild(backdrop);

        const icon = new Sprite(textureRegistry.get(entry.textureName));
        icon.tint = entry.tint;
        fitIcon(icon, cellSize, ICON_INSET);
        cell.addChild(icon);
        if (entry.label !== "") {
            const label = new Text({
                text: entry.label,
                style: {fontFamily: GAME_FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR, fontWeight: "bold", stroke: LABEL_STROKE},
            });
            label.anchor.set(1, 1);
            label.position.set(cellSize - LABEL_INSET, cellSize - LABEL_INSET);
            cell.addChild(label);
        }

        cell.eventMode = "static";
        cell.cursor = "pointer";
        cell.hitArea = new Rectangle(0, 0, cellSize, cellSize);
        cell.on("pointerover", () => {
            if (!selected) {
                backdrop.alpha = HOVER_ALPHA;
            }
            if (onHover !== null) {
                onHover(entry.id, cell);
            }
        });
        cell.on("pointerout", () => {
            if (!selected) {
                backdrop.alpha = 0;
            }
            if (onHover !== null) {
                onHover(null, cell);
            }
        });
        // Propagation left alone, so a scroll drag starting on a cell still scrolls the grid.
        trackTap(cell, () => onPick(entry.id), {stopPropagation: false});
        return cell;
    }
}
