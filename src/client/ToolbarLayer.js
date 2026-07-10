import {Container, Sprite, Text, Rectangle} from "pixi.js";
import Haptics from "@/client/Haptics.js";
import {GAME_FONT} from "@/client/constants.js";
import {TOOLBAR_TEXT, PANEL_TINT} from "@/client/Theme.js";
import {Tween, easeOutBack, easeInCubic} from "@/client/Tween.js";
import {UIPanel} from "@/client/UIPanel.js";
import {TX_SLOT, SLOT_FRAME_INSET} from "@/client/InspectContent.js";
import {addSlotHighlight} from "@/client/slotHighlight.js";
import {debugOutlines, nineSlice} from "@/client/pixiUtils.js";

const SLOT_SIZE = 56;
// Inset of the icon sprite from the slot's edges.
const ICON_PADDING = 7;
const LABEL_GAP = 6;
const LABEL_SIZE = 15;
// Shortcut badge (number/letter) drawn above each slot's icon.
const SHORTCUT_INSET = 4;
// Number-key hotkeys cover the first this-many mod tools (keys 1-9).
const TOOL_SHORTCUT_COUNT = 9;
// Reserved height for the label under each slot, so cells align regardless of text.
const LABEL_HEIGHT = 16;
const CELL_GAP = 12;
const ROW_GAP = 12;
const MARGIN_BOTTOM = 6;
// Tools shown on the visible top row; the rest overflow into the drawer rows below.
const MAX_BAR_TOOLS = 4;
// Inset of the cells from the enclosing panel edge.
const PANEL_PADDING = 10;
// Vertical drawer-toggle strip on the panel's left, as thick as the UIPanel title bar.
const STRIP_WIDTH = 25;
// Gap between the strip and the first cell column.
const STRIP_GAP = 8;
// Left edge of the cell grid: past the strip and its gap.
const GRID_LEFT = PANEL_PADDING + STRIP_WIDTH + STRIP_GAP;
// Duration of the drawer open/close slide tween.
const SLIDE_DURATION_MS = 230;
// Upper bound on the open-slide overshoot as a fraction of the slide; the panel bottom is bled by
// this much (plus a fixed cushion) so the overshoot never exposes its bottom edge.
const OPEN_OVERSHOOT = 0.2;
const DRAWER_BOTTOM_PAD = 12;
// Pointer travel (px) past which a press on the panel is a drawer drag, not a tool tap.
const DRAG_THRESHOLD = 6;

const CELL_HEIGHT = SLOT_SIZE + LABEL_GAP + LABEL_HEIGHT;

/**
 * Static bottom-center tool toolbar: a screen-space HUD sibling of the viewport (on app.stage),
 * not a viewport child, so it never pans or zooms. The whole bar is one panel arranged as a grid:
 * a decorative strip on the left, then the top row (a "no tool" cursor cell plus the first
 * {@link MAX_BAR_TOOLS} tools) resting at the bottom edge while the overflow rows sit off-screen
 * below it. Tapping the strip (or dragging the panel) slides it up to reveal those rows. Each tool
 * is a slot holding its icon sprite with its label underneath; tapping one toggles it active.
 */
export class ToolbarLayer extends Container {

    /**
     * @param {Application} app - the canvas/stage this toolbar lives in (screen space)
     * @param {ClientViewport} viewport - the game area, whose screen width centers the toolbar
     */
    constructor(app, viewport) {
        super();
        this._app = app;
        this._viewport = viewport;
        this.textureRegistry = null;
        this._tools = [];
        this._coreTools = [];
        this._modTools = [];
        this._activeTool = null;
        this._onChange = null;
        // One cell Container per tool, parallel to _tools, so highlights update in place.
        this._cells = [];
        // Always-present top-row cell that selects "no tool" (activeTool null).
        this._noneCell = null;
        // Decorative left strip; tapping it toggles the drawer. Rebuilt in _drawPanel.
        this._drawerStrip = null;
        this._drawerOpen = false;
        // Vertical-drag state for opening/closing the drawer by dragging the panel.
        this._dragging = false;
        this._dragMoved = false;
        this._dragStartY = 0;
        this._dragStartOffset = 0;
        // Window pointerdown listener that closes the drawer on a click off it; installed while
        // open, mirroring MiniMenuLayer.
        this._clickOffListener = null;
        // Grid dimensions, computed on setTools and consumed by _layout for sizing/positioning.
        this._columns = 0;
        this._rowCount = 1;
        this._panelWidth = 0;
        // Vertical slide: 0 rests with the top row at the bottom edge, _slideDistance reveals the
        // overflow rows.
        this._slideDistance = 0;
        this._slide = new Tween(0, SLIDE_DURATION_MS);

        // The single sliding rectangle: its background, the drawer strip, and every cell.
        this._panel = new Container();
        this.addChild(this._panel);
        // Panel background (UIPanel frame), rebuilt in _drawPanel once the size is known.
        this._panelBg = null;
        // Magenta layout-debug outlines (setDebug), a child of _panel so it slides with it.
        this._debugOutlines = null;

        // Drag the panel vertically to open/close the drawer (the only way on mobile; alongside the
        // button on desktop). Handlers ride the bubbled events from the cells and background.
        this._panel.eventMode = "static";
        this._panel.on("pointerdown", (e) => this._onDragStart(e));
        this._panel.on("globalpointermove", (e) => this._onDragMove(e));
        this._panel.on("pointerup", () => this._onDragEnd());
        this._panel.on("pointerupoutside", () => this._onDragEnd());

        this._layout();
        this._app.ticker.add(() => this._layout());
    }

    /**
     * @returns {AbstractTool|null} the selected tool, or null when none is active
     */
    get activeTool() {
        return this._activeTool;
    }

    /**
     * @returns {AbstractTool[]} the tools currently shown, in bar order
     */
    get tools() {
        return this._tools;
    }

    /**
     * @returns {AbstractTool[]} the core tools (letter hotkeys), leading the bar
     */
    get coreTools() {
        return this._coreTools;
    }

    /**
     * @returns {AbstractTool[]} the mod tools (number-key hotkeys), after the core tools
     */
    get modTools() {
        return this._modTools;
    }

    /**
     * Registers the callback invoked whenever the active tool changes (click or programmatic).
     * @param {function(): void} callback
     * @returns {void}
     */
    onChange(callback) {
        this._onChange = callback;
    }

    /**
     * Rebuilds the panel grid for a new tool list, dropping the active selection if it's gone.
     * @param {AbstractTool[]} coreTools - leading tools with letter hotkeys
     * @param {AbstractTool[]} modTools - tools with number-key hotkeys
     * @returns {void}
     */
    setTools(coreTools, modTools) {
        this._coreTools = coreTools;
        this._modTools = modTools;
        this._tools = [...coreTools, ...modTools];
        this._rebuild();
        if (!this._tools.includes(this._activeTool)) {
            this.setActiveTool(null);
        }
        this._refreshHighlights();
        this._layout();
    }

    /**
     * Selects `tool` (or null to deselect), refreshing highlights, closing the drawer, and firing
     * the change callback.
     * @param {AbstractTool|null} tool
     * @returns {void}
     */
    setActiveTool(tool) {
        if (tool === this._activeTool) {
            return;
        }
        this._activeTool = tool;
        this._setDrawerOpen(false);
        this._refreshHighlights();
        if (this._onChange !== null) {
            this._onChange();
        }
    }

    /**
     * Opens or closes the drawer (keyboard shortcut entry point).
     * @returns {void}
     */
    toggleDrawer() {
        this._toggleDrawer();
    }

    /**
     * Toggles a 1px outline around each leaf element, for layout debugging (matches UIPanel). Drawn
     * in panel-local space so it rides the slide.
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
        const outlines = debugOutlines(this._panel.children, this._panel);
        this._debugOutlines = outlines;
        this._panel.addChild(outlines);
    }

    /**
     * Tears down the old slots and lays the grid out row-major in the panel: the "no tool" cell,
     * then the tools. The drawer strip and background are (re)built by _drawPanel.
     * @private
     */
    _rebuild() {
        // Detach any click-off listener and snap to closed before the old slots are destroyed.
        this._setDrawerOpen(false);
        this._slide.reset(0);
        [this._noneCell, ...this._cells].forEach(slot => {
            if (slot !== null) {
                slot.destroy({children: true});
            }
        });

        this._noneCell = this._createNoneCell();
        this._cells = this._tools.map(tool => this._createCell(tool));

        // Row-major grid; the top row is the none cell + the first MAX_BAR_TOOLS tools.
        const slots = [this._noneCell, ...this._cells];
        this._columns = MAX_BAR_TOOLS + 1;
        this._rowCount = Math.ceil(slots.length / this._columns);
        slots.forEach((slot, i) => {
            slot.x = GRID_LEFT + (i % this._columns) * (SLOT_SIZE + CELL_GAP);
            slot.y = PANEL_PADDING + Math.floor(i / this._columns) * (CELL_HEIGHT + ROW_GAP);
            this._panel.addChild(slot);
        });

        this._panelWidth = GRID_LEFT + this._columns * SLOT_SIZE + (this._columns - 1) * CELL_GAP + PANEL_PADDING;
        this._slideDistance = (this._rowCount - 1) * (CELL_HEIGHT + ROW_GAP);
        this._drawPanel();
    }

    /**
     * Redraws the panel rectangle, bleeding below the last row (by the bottom margin, the overshoot
     * allowance, and a cushion) so its bottom edge never clears the screen bottom.
     * @private
     */
    _drawPanel() {
        const content = this._rowCount * CELL_HEIGHT + (this._rowCount - 1) * ROW_GAP;
        const bottomBleed = MARGIN_BOTTOM + DRAWER_BOTTOM_PAD + this._slideDistance * OPEN_OVERSHOOT;
        const height = PANEL_PADDING + content + bottomBleed;
        if (this._panelBg !== null) {
            this._panelBg.destroy();
            this._drawerStrip.destroy({children: true});
        }
        this._panelBg = UIPanel.frameSprite(this.textureRegistry, this._panelWidth, height, PANEL_TINT);
        // Swallow presses on the bar chrome: no tile placement beneath, no click-off close.
        this._panelBg.eventMode = "static";
        this._panelBg.on("pointerdown", (e) => e.nativeEvent.stopPropagation());
        this._panel.addChildAt(this._panelBg, 0);

        // Drawer-toggle strip on the left, spanning the grid rows; above the frame, below the cells.
        this._drawerStrip = this._createDrawerStrip(content);
        this._drawerStrip.position.set(PANEL_PADDING, PANEL_PADDING);
        this._panel.addChildAt(this._drawerStrip, 1);
    }

    /**
     * Builds an interactive slot (background + optional label + icon) with the given press handler.
     * The press is stopped so it neither pans the viewport nor places a tile beneath.
     * @private
     * @param {string|null} label
     * @param {string|null} shortcut - the key badge drawn top-left, or null for none
     * @param {function(Container): void} addIcon - adds the slot's icon
     * @param {function(): void} onPress
     * @returns {Container}
     */
    _createSlot(label, shortcut, addIcon, onPress) {
        const slot = new Container();
        slot.eventMode = "static";
        slot.cursor = "pointer";

        slot._bg = nineSlice(this.textureRegistry, TX_SLOT, SLOT_FRAME_INSET, SLOT_FRAME_INSET, SLOT_SIZE, SLOT_SIZE);
        slot._bg.tint = PANEL_TINT;
        slot.addChild(slot._bg);

        // Active/hover highlight: filled rect inset in the slot, solid-ish when active, faint on hover.
        slot._highlight = addSlotHighlight(slot, SLOT_SIZE);

        addIcon(slot);

        // Badge sits above the icon; only read with the drawer open, so hidden on the resting top row.
        if (shortcut !== null) {
            const badge = new Text({
                text: shortcut,
                style: {fontFamily: GAME_FONT, fontSize: SLOT_SIZE - 3, fill: 0xffffff, stroke: {color: 0x000000, width: 1}},
            });
            badge.x = slot.width / 2 + 1;
            badge.y = (slot.height / 2) - 2;
            badge.anchor = 0.5;
            badge.alpha = 0.5;
            badge.visible = this._drawerOpen;
            slot.addChild(badge);
            slot._badge = badge;
        }

        if (label !== null) {
            const text = new Text({
                text: label,
                style: {fontFamily: GAME_FONT, fontSize: LABEL_SIZE, fill: 0xffffff, stroke: {color: 0x000000, width: 1}},
            });
            text.x = (SLOT_SIZE - text.width) / 2;
            text.y = SLOT_SIZE + LABEL_GAP;
            slot.addChild(text);
        }

        // The pointer id whose press landed on this slot; a tap only counts if release matches, so a
        // map drag or pinch that merely ends over the slot (its press was elsewhere) never clicks.
        slot._pressPointerId = null;
        // Swallow the press so it neither pans the viewport nor places a tile beneath.
        slot.on("pointerdown", (e) => {
            e.nativeEvent.stopPropagation();
            // Only the primary button arms a tap; a right/middle press never counts as a click.
            if (e.button === 0) {
                slot._pressPointerId = e.pointerId;
            }
        });
        // Act on release only when this slot held the press, and the gesture didn't become a drawer drag.
        slot.on("pointerup", (e) => {
            const pressed = slot._pressPointerId === e.pointerId;
            slot._pressPointerId = null;
            if (!pressed || this._dragMoved) {
                return;
            }
            Haptics.tap();
            onPress();
        });
        slot.on("pointerupoutside", () => {
            slot._pressPointerId = null;
        });
        return slot;
    }

    /**
     * Builds one tool cell: its icon sprite, toggling the tool on tap.
     * @private
     * @param {AbstractTool} tool
     * @returns {Container}
     */
    _createCell(tool) {
        return this._createSlot(
            tool.label,
            this._shortcutFor(tool),
            (slot) => this._addSprite(slot, tool.textureName),
            () => this.setActiveTool(tool === this._activeTool ? null : tool),
        );
    }

    /**
     * Shortcut badge for a tool: its core letter hotkey, or its number-key slot among mod tools.
     * @private
     * @param {AbstractTool} tool
     * @returns {string|null}
     */
    _shortcutFor(tool) {
        if (tool.hotkey !== null) {
            return tool.hotkey.toUpperCase();
        }
        const index = this._modTools.indexOf(tool);
        if (index < 0 || index >= TOOL_SHORTCUT_COUNT) {
            return null;
        }
        return String(index + 1);
    }

    /**
     * Builds the "no tool" cell: an inspect icon that deselects on tap.
     * @private
     * @returns {Container}
     */
    _createNoneCell() {
        return this._createSlot(
            "Inspect",
            "Q",
            (slot) => this._addSprite(slot, "inspect/1x1"),
            () => this.setActiveTool(null),
        );
    }

    /**
     * Builds the left drawer strip: a title-bar-style pattern rectangle that toggles the drawer on
     * tap (unless the press became a panel drag). Mirrors the slot's press/drag arming.
     * @private
     * @param {number} height - the strip's height (the grid rows it spans)
     * @returns {TilingSprite}
     */
    _createDrawerStrip(height) {
        const strip = UIPanel.patternStrip(this.textureRegistry, STRIP_WIDTH, height);
        strip.eventMode = "static";
        strip.cursor = "pointer";
        // Hit the whole left gutter, from the panel edge to the first slot column.
        strip.hitArea = new Rectangle(-PANEL_PADDING, -PANEL_PADDING, GRID_LEFT, height + PANEL_PADDING);
        strip._pressPointerId = null;
        strip.on("pointerdown", (e) => {
            e.nativeEvent.stopPropagation();
            if (e.button === 0) {
                strip._pressPointerId = e.pointerId;
            }
        });
        strip.on("pointerup", (e) => {
            const pressed = strip._pressPointerId === e.pointerId;
            strip._pressPointerId = null;
            if (!pressed || this._dragMoved) {
                return;
            }
            Haptics.tap();
            this._toggleDrawer();
        });
        strip.on("pointerupoutside", () => {
            strip._pressPointerId = null;
        });
        return strip;
    }

    /**
     * Adds a texture's sprite centered and scaled to fit the slot.
     * @private
     * @param {Container} slot
     * @param {string} textureName
     */
    _addSprite(slot, textureName) {
        const texture = this.textureRegistry.get(textureName);
        const icon = new Sprite(texture);
        icon.anchor = 0.5;
        const fit = SLOT_SIZE - ICON_PADDING * 2;
        icon.scale = Math.min(fit / texture.width, fit / texture.height);
        icon.position.set(SLOT_SIZE / 2, SLOT_SIZE / 2);
        slot.addChild(icon);
    }

    /**
     * @private
     */
    _toggleDrawer() {
        this._setDrawerOpen(!this._drawerOpen);
    }

    /**
     * Opens or closes the drawer: tweens the slide (overshoot open / accelerate closed) and
     * installs/removes the click-off listener. The press that toggles it is stopped before it
     * bubbles to the window, so it doesn't self-close.
     * @private
     * @param {boolean} open
     */
    _setDrawerOpen(open) {
        this._drawerOpen = open;
        this._setBadgesVisible(open);
        this._slide.to(open ? this._slideDistance : 0, open ? easeOutBack : easeInCubic);
        if (open && this._clickOffListener === null) {
            this._clickOffListener = () => this._setDrawerOpen(false);
            window.addEventListener("pointerdown", this._clickOffListener);
        } else if (!open && this._clickOffListener !== null) {
            window.removeEventListener("pointerdown", this._clickOffListener);
            this._clickOffListener = null;
        }
    }

    /**
     * Shows or hides every slot's shortcut badge (badges only read with the drawer open).
     * @private
     * @param {boolean} visible
     */
    _setBadgesVisible(visible) {
        [this._noneCell, ...this._cells].forEach(slot => {
            if (slot !== null && slot._badge != null) {
                slot._badge.visible = visible;
            }
        });
    }

    /**
     * Begins tracking a possible drawer drag; the press is a tool tap until it moves past the threshold.
     * @private
     * @param {FederatedPointerEvent} e
     */
    _onDragStart(e) {
        this._dragging = true;
        this._dragMoved = false;
        this._dragStartY = e.global.y;
        this._dragStartOffset = this._slide.value;
    }

    /**
     * While dragging, moves the panel with the pointer (up reveals rows, down hides them).
     * @private
     * @param {FederatedPointerEvent} e
     */
    _onDragMove(e) {
        if (!this._dragging) {
            return;
        }
        const dy = e.global.y - this._dragStartY;
        if (Math.abs(dy) > DRAG_THRESHOLD) {
            this._dragMoved = true;
        }
        const offset = Math.max(0, Math.min(this._slideDistance, this._dragStartOffset - dy));
        this._slide.reset(offset);
    }

    /**
     * Settles a drag to fully open or closed by how far it was pulled; a tap (no drag) is left to the cell.
     * @private
     */
    _onDragEnd() {
        if (!this._dragging) {
            return;
        }
        this._dragging = false;
        if (this._dragMoved) {
            this._setDrawerOpen(this._slide.value > this._slideDistance / 2);
        }
        // Cleared after the cells' pointerup handlers have read it (they fire first, as the target).
        this._dragMoved = false;
    }

    /**
     * Repaints the none cell and every tool cell to match the active selection.
     * @private
     */
    _refreshHighlights() {
        if (this._noneCell !== null) {
            this._noneCell._highlight.setActive(this._activeTool === null);
        }
        this._cells.forEach((cell, index) => {
            cell._highlight.setActive(this._tools[index] === this._activeTool);
        });
    }

    /**
     * Centers the panel horizontally and advances the slide tween so the rows glide into/out of view.
     * @private
     */
    _layout() {
        // Nothing is laid out until the first setTools builds the none cell.
        this._panel.visible = this._noneCell !== null;
        if (this._noneCell === null) {
            return;
        }
        // Collapsed panel top: its top row sits above the bottom margin, rows below spill off-screen.
        const collapsedTop = this._app.screen.height - MARGIN_BOTTOM - PANEL_PADDING - CELL_HEIGHT;
        const offset = this._slide.advance(this._app.ticker.deltaMS);

        // Center the panel.
        const panelX = (this._viewport.screenWidth - this._panelWidth) / 2;
        this._panel.position.set(panelX, collapsedTop - offset);
    }
}
