import {Container, Graphics, Rectangle, Sprite} from "pixi.js";
import {ScrollView} from "@/client/hud/ScrollView.js";
import {UIPanel} from "@/client/hud/UIPanel.js";
import {PANEL_TINT, ACTIVE_ACCENT} from "@/client/Theme.js";
import {fitIcon, trackTap} from "@/client/layers/pixiUtils.js";
import {ICON_CELL_SIZE as CELL_SIZE} from "@/client/hud/UiScale.js";

const CELL_GAP = 4;
const ICON_INSET = 6;
const PADDING = 6;
const SELECTED_ALPHA = 0.35;
const HOVER_ALPHA = 0.15;
const DEFAULT_COLUMNS = 6;
const DEFAULT_VISIBLE_ROWS = 4;

/**
 * One pickable icon.
 */
export class IconPickerEntry {

    /**
     * @param {number} id
     * @param {string} textureName
     * @param {number} [tint]
     */
    constructor(id, textureName, tint = 0xffffff) {
        this.id = id;
        this.textureName = textureName;
        this.tint = tint;
    }
}

/**
 * A scrollable grid of tappable icons over an inset background; scales to hundreds of entries.
 * Generic: item choosers, marker-icon choosers, anything picked by sight.
 */
export class IconPicker extends Container {

    /**
     * @param {TextureRegistry} textureRegistry
     * @param {ClientViewport|null} viewport - frozen against wheel-zoom while the scrollbar is hovered
     * @param {number} width
     * @param {IconPickerEntry[]} entries
     * @param {function(number): void} onPick - receives the picked entry's id
     * @param {{columns: number, visibleRows: number, selectedId: number|null}} [options]
     */
    constructor(
        textureRegistry,
        viewport,
        width,
        entries,
        onPick,
        {columns = DEFAULT_COLUMNS, visibleRows = DEFAULT_VISIBLE_ROWS, selectedId = null} = {},
    ) {
        super();
        const rows = Math.ceil(entries.length / columns);
        const contentHeight = rows * (CELL_SIZE + CELL_GAP) - CELL_GAP + PADDING * 2;
        const viewportHeight = Math.min(
            contentHeight,
            visibleRows * (CELL_SIZE + CELL_GAP) - CELL_GAP + PADDING * 2,
        );
        this.pickerHeight = viewportHeight;

        this.addChild(UIPanel.insetSprite(textureRegistry, width, viewportHeight, PANEL_TINT));

        const grid = new Container();
        for (const [index, entry] of entries.entries()) {
            const cell = this._buildCell(textureRegistry, entry, entry.id === selectedId, onPick);
            cell.x = PADDING + (index % columns) * (CELL_SIZE + CELL_GAP);
            cell.y = PADDING + Math.floor(index / columns) * (CELL_SIZE + CELL_GAP);
            grid.addChild(cell);
        }

        if (contentHeight <= viewportHeight) {
            this.addChild(grid);
            return;
        }
        const scrollView = new ScrollView(textureRegistry, viewport, width, viewportHeight);
        scrollView.content.addChild(grid);
        scrollView.setContentHeight(contentHeight);
        this.addChild(scrollView);
    }

    /**
     * One icon cell: highlight backdrop, scaled tinted sprite, drag-tolerant tap.
     * @private
     * @param {TextureRegistry} textureRegistry
     * @param {IconPickerEntry} entry
     * @param {boolean} selected
     * @param {function(number): void} onPick
     * @returns {Container}
     */
    _buildCell(textureRegistry, entry, selected, onPick) {
        const cell = new Container();
        const backdrop = new Graphics().roundRect(0, 0, CELL_SIZE, CELL_SIZE, 4).fill(ACTIVE_ACCENT);
        if (selected) {
            backdrop.alpha = SELECTED_ALPHA;
        } else {
            backdrop.alpha = 0;
        }
        cell.addChild(backdrop);

        const icon = new Sprite(textureRegistry.get(entry.textureName));
        icon.tint = entry.tint;
        fitIcon(icon, CELL_SIZE, ICON_INSET);
        cell.addChild(icon);

        cell.eventMode = "static";
        cell.cursor = "pointer";
        cell.hitArea = new Rectangle(0, 0, CELL_SIZE, CELL_SIZE);
        cell.on("pointerover", () => {
            if (!selected) {
                backdrop.alpha = HOVER_ALPHA;
            }
        });
        cell.on("pointerout", () => {
            if (!selected) {
                backdrop.alpha = 0;
            }
        });
        // Propagation left alone, so a scroll drag starting on a cell still scrolls the grid.
        trackTap(cell, () => onPick(entry.id), {stopPropagation: false});
        return cell;
    }
}
