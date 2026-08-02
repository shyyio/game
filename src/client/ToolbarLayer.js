import {Container, Sprite, Text, Rectangle, FederatedPointerEvent} from "pixi.js";
import Haptics from "@/client/Haptics.js";
import {GAME_FONT} from "@/client/constants.js";
import {TOOLBAR_TEXT, PANEL_TINT} from "@/client/Theme.js";
import {Tween, easeOutBack, easeInCubic} from "@/client/Tween.js";
import ReducedMotion from "@/client/ReducedMotion.js";
import Mobile from "@/client/Mobile.js";
import {UIPanel} from "@/client/UIPanel.js";
import {TX_SLOT, SLOT_FRAME_INSET} from "@/client/InspectContent.js";
import {addSlotHighlight} from "@/client/slotHighlight.js";
import {debugOutlines, nineSlice, swallowClicks, trackTap} from "@/client/pixiUtils.js";

const SLOT_SIZE = 56;
// Inset of the icon sprite from the slot's edges.
const ICON_PADDING = 7;
const LABEL_GAP = 0;
const LABEL_SIZE = 15;
// Number-key hotkeys cover the first this-many mod tools (keys 1-9).
const TOOL_SHORTCUT_COUNT = 9;
// Reserved height for the label under each slot (up to 2 wrapped lines), so cells align regardless of text.
const LABEL_HEIGHT = 34;
const CELL_GAP = 12;
const ROW_GAP = 12;
const MARGIN_BOTTOM = 6;
// Tools on the visible top row; rest overflow into drawer rows. Fixed on mobile, grows on desktop.
const MIN_BAR_TOOLS = 4;
// Desktop upper bound on visible top-row tools, reached only on wide-enough screens.
const MAX_BAR_TOOLS_DESKTOP = 10;
// Screen margin kept clear on each side when sizing the desktop bar.
const SIDE_MARGIN = 40;
// Inset of the cells from the enclosing panel edge.
const PANEL_PADDING = 10;
// Gap between the outer frame and the sunken inset body (matches the inspect panel's body margin).
const INSET_MARGIN = 6;
// Vertical drawer-toggle strip on the panel's left, as thick as the UIPanel title bar.
const STRIP_WIDTH = 25;
// Gap between the strip and the inset body's left edge.
const STRIP_GAP = 6;
// Left edge of the inset body: past the strip and its gap.
const INSET_LEFT = PANEL_PADDING + STRIP_WIDTH + STRIP_GAP;
// Left padding inside the inset before the first cell column.
const INSET_PADDING = 12;
// Left edge of the cell grid.
const GRID_LEFT = INSET_LEFT + INSET_PADDING;
// Duration of the drawer open/close slide tween.
const SLIDE_DURATION_MS = 230;
// Open-slide overshoot as a fraction of the slide; panel bottom is bled by this much to cover it.
const OPEN_OVERSHOOT = 0.2;
const DRAWER_BOTTOM_PAD = 12;

const CELL_HEIGHT = SLOT_SIZE + LABEL_GAP + LABEL_HEIGHT;

/**
 * Static bottom-center tool toolbar: one panel grid, top row visible, overflow rows in a slide-out drawer.
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
        // Window pointerdown listener that closes the drawer on a click off it; installed while
        // open.
        this._clickOffListener = null;
        // Grid dimensions, computed on setTools and consumed by _layout for sizing/positioning.
        this._columns = 0;
        this._rowCount = 1;
        this._panelWidth = 0;
        // Top-row tool capacity, recomputed from screen width; triggers a rebuild when it changes.
        this._barTools = this._computeBarTools();
        // Vertical slide: 0 rests with the top row at the bottom edge, _slideDistance reveals the
        // overflow rows.
        this._slideDistance = 0;
        this._slide = new Tween(0, SLIDE_DURATION_MS);

        // The single sliding rectangle: its background, the drawer strip, and every cell.
        this._panel = new Container();
        this.addChild(this._panel);
        // Panel background (UIPanel frame), rebuilt in _drawPanel once the size is known.
        this._panelBg = null;
        this._inset = null;
        // Magenta layout-debug outlines (setDebug), a child of _panel so it slides with it.
        this._debugOutlines = null;

        this._panel.eventMode = "static";

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
        this._setDrawerOpen(false);
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
        if (this._activeTool !== null) {
            this._activeTool.onDeactivate();
        }
        this._activeTool = tool;
        if (tool !== null) {
            tool.onActivate();
        }
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
     * Toggles a 1px outline around each leaf element, for layout debugging (matches UIPanel).
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
     * Tears down the old slots and lays the grid out row-major; leaves `_drawerOpen` as-is so a resize doesn't close it.
     * @private
     */
    _rebuild() {
        for (const slot of [this._noneCell, ...this._cells]) {
            if (slot !== null) {
                slot.destroy({children: true});
            }
        }

        this._noneCell = this._createNoneCell();
        this._cells = this._tools.map(tool => this._createCell(tool));

        // Row-major grid; the top row is the none cell + the first _barTools tools.
        const slots = [this._noneCell, ...this._cells];
        this._columns = this._barTools + 1;
        this._rowCount = Math.ceil(slots.length / this._columns);
        for (const [i, slot] of slots.entries()) {
            slot.x = GRID_LEFT + (i % this._columns) * (SLOT_SIZE + CELL_GAP);
            slot.y = PANEL_PADDING + Math.floor(i / this._columns) * (CELL_HEIGHT + ROW_GAP);
            this._panel.addChild(slot);
        }

        this._panelWidth = GRID_LEFT + this._columns * SLOT_SIZE + (this._columns - 1) * CELL_GAP + PANEL_PADDING;
        this._slideDistance = (this._rowCount - 1) * (CELL_HEIGHT + ROW_GAP);
        // Snap to the resting position for the current open/closed state under the rebuilt geometry.
        this._slide.reset(this._drawerOpen ? this._slideDistance : 0);
        this._drawPanel();
    }

    /**
     * Redraws the panel rectangle, bleeding below the last row so its bottom edge never clears the screen.
     * @private
     */
    _drawPanel() {
        const content = this._rowCount * CELL_HEIGHT + (this._rowCount - 1) * ROW_GAP;
        const bottomBleed = MARGIN_BOTTOM + DRAWER_BOTTOM_PAD + this._slideDistance * OPEN_OVERSHOOT;
        const height = PANEL_PADDING + content + bottomBleed;
        if (this._panelBg !== null) {
            this._panelBg.destroy();
            this._inset.destroy();
            this._drawerStrip.destroy({children: true});
        }
        this._panelBg = UIPanel.frameSprite(this.textureRegistry, this._panelWidth, height, PANEL_TINT);
        // Swallow presses on the bar background: no tile placement beneath, no click-off close.
        swallowClicks(this._panelBg, {pixi: false, native: true});
        this._panel.addChildAt(this._panelBg, 0);

        // Inset holds only the cell grid: it starts right of the pattern strip.
        const insetWidth = this._panelWidth - INSET_MARGIN - INSET_LEFT;
        this._inset = UIPanel.insetSprite(this.textureRegistry, insetWidth, height - INSET_MARGIN * 2, PANEL_TINT);
        this._inset.position.set(INSET_LEFT, INSET_MARGIN);
        this._panel.addChildAt(this._inset, 1);

        // Drawer-toggle strip on the left, spanning the grid rows; above the inset, below the cells.
        this._drawerStrip = this._createDrawerStrip(content);
        this._drawerStrip.position.set(PANEL_PADDING, PANEL_PADDING);
        this._panel.addChildAt(this._drawerStrip, 2);
    }

    /**
     * Builds an interactive slot (background + optional label + icon) with the given press handler.
     * @private
     * @param {string|null} label
     * @param {string|null} shortcut - the key badge drawn top-left, or null for none
     * @param {function(Container): void} addIcon - adds the slot's icon
     * @param {function(): void} onPress
     * @returns {Container}
     */
    _createSlot(label, shortcut, addIcon, onPress) {
        const slot = new Container();
        slot.cursor = "pointer";

        slot._bg = nineSlice(this.textureRegistry, TX_SLOT, SLOT_FRAME_INSET, SLOT_FRAME_INSET, SLOT_SIZE, SLOT_SIZE);
        slot._bg.tint = PANEL_TINT;
        slot.addChild(slot._bg);

        // Active/hover highlight: filled rect inset in the slot, solid-ish when active, faint on hover.
        slot._highlight = addSlotHighlight(slot, SLOT_SIZE);

        addIcon(slot);

        // Badge sits above the icon, hidden on the resting top row; no badges on Mobile (no keyboard).
        if (shortcut !== null && !Mobile.enabled) {
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
                style: {
                    fontFamily: GAME_FONT,
                    fontSize: LABEL_SIZE,
                    fill: TOOLBAR_TEXT,
                    align: "center",
                    wordWrap: true,
                    wordWrapWidth: SLOT_SIZE + CELL_GAP,
                },
            });
            text.anchor.x = 0.5;
            text.x = SLOT_SIZE / 2;
            text.y = SLOT_SIZE + LABEL_GAP;
            slot.addChild(text);
        }

        // trackTap swallows the press and only counts a release matching the press that landed here.
        trackTap(slot, () => {
            Haptics.tap();
            onPress();
        }, {stopNativePropagation: true});
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
            () => {
                if (tool === this._activeTool) {
                    this.setActiveTool(null);
                } else {
                    this.setActiveTool(tool);
                }
            },
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
     * Builds the left drawer strip: a title-bar-style pattern rectangle that toggles the drawer
     * on tap.
     * @private
     * @param {number} height - the strip's height (the grid rows it spans)
     * @returns {TilingSprite}
     */
    _createDrawerStrip(height) {
        const strip = UIPanel.patternStrip(this.textureRegistry, STRIP_WIDTH, height);
        strip.cursor = "pointer";
        // Hit the whole left gutter, from the panel edge to the first slot column.
        strip.hitArea = new Rectangle(-PANEL_PADDING, -PANEL_PADDING, GRID_LEFT, height + PANEL_PADDING);
        trackTap(strip, () => {
            Haptics.tap();
            this._toggleDrawer();
        }, {stopNativePropagation: true});
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
     * Opens or closes the drawer: tweens the slide and installs/removes the click-off listener.
     * @private
     * @param {boolean} open
     */
    _setDrawerOpen(open) {
        this._drawerOpen = open;
        this._setBadgesVisible(open);
        let slideTarget;
        let slideEase;
        if (open) {
            slideTarget = this._slideDistance;
            slideEase = easeOutBack;
        } else {
            slideTarget = 0;
            slideEase = easeInCubic;
        }
        if (ReducedMotion.enabled) {
            this._slide.reset(slideTarget);
        } else {
            this._slide.to(slideTarget, slideEase);
        }
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
        for (const slot of [this._noneCell, ...this._cells]) {
            if (slot !== null && slot._badge != null) {
                slot._badge.visible = visible;
            }
        }
    }

    /**
     * Repaints the none cell and every tool cell to match the active selection.
     * @private
     */
    _refreshHighlights() {
        if (this._noneCell !== null) {
            this._noneCell._highlight.setActive(this._activeTool === null);
        }
        for (const [index, cell] of this._cells.entries()) {
            cell._highlight.setActive(this._tools[index] === this._activeTool);
        }
    }

    /**
     * Top-row tool capacity: fixed on Mobile, otherwise as many as fit the screen width, clamped
     * between MIN_BAR_TOOLS and MAX_BAR_TOOLS_DESKTOP.
     * @private
     * @returns {number}
     */
    _computeBarTools() {
        if (Mobile.enabled) {
            return MIN_BAR_TOOLS;
        }
        const maxWidth = this._viewport.screenWidth - SIDE_MARGIN * 2;
        const columns = Math.floor((maxWidth - GRID_LEFT - PANEL_PADDING + CELL_GAP) / (SLOT_SIZE + CELL_GAP));
        return Math.max(MIN_BAR_TOOLS, Math.min(MAX_BAR_TOOLS_DESKTOP, columns - 1));
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
        // Screen width changed enough to fit more/fewer desktop tools: rebuild the grid for it.
        const barTools = this._computeBarTools();
        if (barTools !== this._barTools) {
            this._barTools = barTools;
            this._rebuild();
            this._refreshHighlights();
        }
        // Collapsed panel top: its top row sits above the bottom margin, rows below spill off-screen.
        const collapsedTop = this._app.screen.height - MARGIN_BOTTOM - PANEL_PADDING - CELL_HEIGHT;
        const offset = this._slide.advance(this._app.ticker.deltaMS);

        // Center the panel.
        const panelX = (this._viewport.screenWidth - this._panelWidth) / 2;
        this._panel.position.set(panelX, collapsedTop - offset);
    }
}
