import {Container, Sprite, Text, Rectangle, FederatedPointerEvent} from "pixi.js";
import Haptics from "@/client/Haptics.js";
import {GAME_FONT} from "@/client/constants.js";
import {PANEL_TINT_TEXT, PANEL_TINT} from "@/client/Theme.js";
import {Tween, easeOutBack, easeInCubic} from "@/client/layers/Tween.js";
import ReducedMotion from "@/client/ReducedMotion.js";
import Mobile from "@/client/Mobile.js";
import {UIPanel} from "@/client/hud/UIPanel.js";
import {TX_SLOT, SLOT_FRAME_INSET} from "@/client/hud/slotFrame.js";
import {addSlotHighlight} from "@/client/hud/slotHighlight.js";
import {nineSlice, swallowClicks, trackTap, trackWindowDrag} from "@/client/layers/pixiUtils.js";
import {TOOLBAR_SLOT_SIZE as SLOT_SIZE} from "@/client/hud/UiScale.js";

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
// Hold time before a press on a mod-tool cell picks it up for a reorder drag, instead of a tap.
const REORDER_HOLD_MS = 400;
// Movement past this many px before the hold timer fires cancels the pickup (and the tap).
const REORDER_MOVE_CANCEL_PX = 8;
// How large the picked-up cell grows, and how long it takes to get there.
const DRAG_LIFT_SCALE = 1.12;
const DRAG_LIFT_DURATION_MS = 150;
// Open-slide overshoot as a fraction of the slide; panel bottom is bled by this much to cover it.
const OPEN_OVERSHOOT = 0.2;
const DRAWER_BOTTOM_PAD = 12;

/**
 * A slot cell's full height, recomputed per call so it follows the UI scale.
 * @returns {number}
 */
function cellHeight() {
    return SLOT_SIZE + LABEL_GAP + LABEL_HEIGHT;
}

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
        this._onReorder = null;
        // Set only while a mod-tool cell is picked up for a reorder drag.
        this._dragState = null;
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
     * Registers the callback fired when a mod-tool drag reorder completes, with the tools in
     * their new order.
     * @param {function(AbstractTool[]): void} callback
     * @returns {void}
     */
    onReorder(callback) {
        this._onReorder = callback;
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
        // Not closed here: a reorder commits by calling this same method, and should leave the
        // drawer exactly as the user left it mid-drag.
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
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        this._rebuild();
    }

    /**
     * Tears down the old slots and lays the grid out row-major; leaves `_drawerOpen` as-is so a resize doesn't close it.
     * @private
     */
    _rebuild() {
        // An in-progress reorder drag's slot is about to be destroyed below; abort it rather than
        // leaving _dragState pointing at a dead Container.
        this._cancelDrag();

        for (const slot of [this._noneCell, ...this._cells]) {
            if (slot !== null) {
                slot.destroy({children: true});
            }
        }

        this._noneCell = this._createNoneCell();
        this._cells = this._tools.map((tool, index) => this._createCell(tool, index >= this._coreTools.length));

        // Row-major grid; the top row is the none cell + the first _barTools tools.
        const slots = [this._noneCell, ...this._cells];
        this._columns = this._barTools + 1;
        this._rowCount = Math.ceil(slots.length / this._columns);
        for (const [i, slot] of slots.entries()) {
            const position = this._slotPosition(i);
            slot.x = position.x;
            slot.y = position.y;
            this._panel.addChild(slot);
        }

        this._panelWidth = GRID_LEFT + this._columns * SLOT_SIZE + (this._columns - 1) * CELL_GAP + PANEL_PADDING;
        this._slideDistance = (this._rowCount - 1) * (cellHeight() + ROW_GAP);
        // Snap to the resting position for the current open/closed state under the rebuilt geometry.
        this._slide.reset(this._drawerOpen ? this._slideDistance : 0);
        this._drawPanel();
    }

    /**
     * Redraws the panel rectangle, bleeding below the last row so its bottom edge never clears the screen.
     * @private
     */
    _drawPanel() {
        const content = this._rowCount * cellHeight() + (this._rowCount - 1) * ROW_GAP;
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
     * @param {boolean} [liveBadge] - keeps the badge around even with no shortcut yet, so a
     *     reorder drag can fill it in live (mod-tool cells: their hotkey slot can change)
     * @returns {Container}
     */
    _createSlot(label, shortcut, addIcon, liveBadge=false) {
        const slot = new Container();
        slot.cursor = "pointer";

        slot._bg = nineSlice(this.textureRegistry, TX_SLOT, SLOT_FRAME_INSET, SLOT_FRAME_INSET, SLOT_SIZE, SLOT_SIZE);
        slot._bg.tint = PANEL_TINT;
        slot.addChild(slot._bg);

        // Active/hover highlight: filled rect inset in the slot, solid-ish when active, faint on hover.
        slot._highlight = addSlotHighlight(slot, SLOT_SIZE);

        addIcon(slot);

        // Badge sits above the icon, hidden on the resting top row; no badges on Mobile (no keyboard).
        if ((shortcut !== null || liveBadge) && !Mobile.enabled) {
            const badge = new Text({
                text: shortcut === null ? "" : shortcut,
                style: {fontFamily: GAME_FONT, fontSize: SLOT_SIZE - 3, fill: PANEL_TINT_TEXT, stroke: {color: PANEL_TINT, width: 1}},
            });
            badge.x = slot.width / 2 + 1;
            badge.y = (slot.height / 2) - 2;
            badge.anchor = 0.5;
            badge.alpha = 0.6;
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
                    fill: PANEL_TINT_TEXT,
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

        return slot;
    }

    /**
     * Builds one tool cell: its icon sprite, toggling the tool on tap. Mod-tool cells additionally
     * pick up for a reorder drag on a long press.
     * @private
     * @param {AbstractTool} tool
     * @param {boolean} draggable
     * @returns {Container}
     */
    _createCell(tool, draggable) {
        const slot = this._createSlot(tool.label, this._shortcutFor(tool), (slot) => this._addSprite(slot, tool.textureName), draggable);
        const onPress = () => {
            if (tool === this._activeTool) {
                this.setActiveTool(null);
            } else {
                this.setActiveTool(tool);
            }
        };
        if (draggable) {
            this._wireDraggableCell(slot, tool, onPress);
        } else {
            // trackTap swallows the press and only counts a release matching the press that landed here.
            trackTap(slot, () => {
                Haptics.tap();
                onPress();
            }, {stopNativePropagation: true});
        }
        return slot;
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
        return this._shortcutForIndex(this._modTools.indexOf(tool));
    }

    /**
     * The number-key badge for a mod tool at `index` among mod tools, or null past the
     * shortcut-eligible range (also null for a negative/not-found index).
     * @private
     * @param {number} index
     * @returns {string|null}
     */
    _shortcutForIndex(index) {
        if (index < 0 || index >= TOOL_SHORTCUT_COUNT) {
            return null;
        }
        return String(index + 1);
    }

    /**
     * The rest position of the flat slot at `flatIndex` (0 = none cell, then tools in bar order).
     * @private
     * @param {number} flatIndex
     * @returns {{x: number, y: number}}
     */
    _slotPosition(flatIndex) {
        return {
            x: GRID_LEFT + (flatIndex % this._columns) * (SLOT_SIZE + CELL_GAP),
            y: PANEL_PADDING + Math.floor(flatIndex / this._columns) * (cellHeight() + ROW_GAP),
        };
    }

    /**
     * Wires a mod-tool cell's combined gesture: a plain tap fires `onPress`; holding past
     * {@link REORDER_HOLD_MS} without drifting past {@link REORDER_MOVE_CANCEL_PX} picks the cell
     * up for a reorder drag instead.
     * @private
     * @param {Container} slot
     * @param {AbstractTool} tool
     * @param {function(): void} onPress
     */
    _wireDraggableCell(slot, tool, onPress) {
        slot.eventMode = "static";
        let pointerId = null;
        let startX = 0;
        let startY = 0;
        let holdTimer = null;

        const cancelHold = () => {
            if (holdTimer !== null) {
                window.clearTimeout(holdTimer);
                holdTimer = null;
            }
        };

        slot.on("pointerdown", (e) => {
            e.stopPropagation();
            e.nativeEvent.stopPropagation();
            if (e.button !== 0 || pointerId !== null) {
                return;
            }
            pointerId = e.pointerId;
            startX = e.global.x;
            startY = e.global.y;
            holdTimer = window.setTimeout(() => {
                holdTimer = null;
                // Reordering needs the drawer open (every mod-tool slot visible to drag into);
                // closed, the hold just falls through to a normal tap on release.
                if (!this._drawerOpen) {
                    return;
                }
                // Once the drag starts, window-level tracking (trackWindowDrag) takes over the
                // gesture; this pointer's tap detection is done.
                pointerId = null;
                this._beginDrag(slot, tool, e);
            }, REORDER_HOLD_MS);
        });

        slot.on("globalpointermove", (e) => {
            if (pointerId === null || e.pointerId !== pointerId) {
                return;
            }
            if (Math.hypot(e.global.x - startX, e.global.y - startY) > REORDER_MOVE_CANCEL_PX) {
                cancelHold();
                pointerId = null;
            }
        });

        const endPress = (e) => {
            if (pointerId === null || e.pointerId !== pointerId) {
                return;
            }
            cancelHold();
            pointerId = null;
            Haptics.tap();
            onPress();
        };
        slot.on("pointerup", endPress);
        slot.on("pointerupoutside", endPress);
    }

    /**
     * Picks a mod-tool cell's icon up for a reorder drag: haptic pulse, detaches the icon sprite
     * to the panel (front, above every slot) so only the icon lifts and follows the pointer,
     * while the slot's background/label/badge stay put and reflow in place like any other cell.
     * Starts a working copy of the mod-tool order that live-reorders as the drag crosses slots.
     * Movement/release tracking is handed off to {@link trackWindowDrag} for the rest of the
     * gesture.
     * @private
     * @param {Container} slot
     * @param {AbstractTool} tool
     * @param {FederatedPointerEvent} e
     */
    _beginDrag(slot, tool, e) {
        Haptics.tap();

        const icon = slot._icon;
        const iconBaseScale = icon.scale.x;
        const originX = slot.x + icon.x;
        const originY = slot.y + icon.y;
        icon.position.set(originX, originY);
        this._panel.addChild(icon);

        const scaleTween = new Tween(1, DRAG_LIFT_DURATION_MS);
        if (ReducedMotion.enabled) {
            scaleTween.reset(DRAG_LIFT_SCALE);
        } else {
            scaleTween.to(DRAG_LIFT_SCALE, easeOutBack);
        }

        const detachDrag = trackWindowDrag(e.nativeEvent, (deltaX, deltaY) => {
            this._updateDrag(originX + deltaX, originY + deltaY);
        }, () => this._endDrag());

        this._dragState = {
            tool,
            icon,
            iconBaseScale,
            scaleTween,
            order: [...this._modTools],
            detachDrag,
        };
    }

    /**
     * Follows the pointer with the dragged icon and live-reorders the working copy when it
     * crosses into a neighboring slot.
     * @private
     * @param {number} x
     * @param {number} y
     */
    _updateDrag(x, y) {
        const drag = this._dragState;
        drag.icon.x = x;
        drag.icon.y = y;

        const nearest = this._nearestModToolIndex(x, y);
        const currentIndex = drag.order.indexOf(drag.tool);
        if (nearest !== currentIndex) {
            drag.order.splice(currentIndex, 1);
            drag.order.splice(nearest, 0, drag.tool);
            this._layoutDragOrder(drag);
            this._refreshDragBadges(drag);
        }
    }

    /**
     * The persistent cell Container for a mod tool, regardless of where the working order has
     * moved it to.
     * @private
     * @param {AbstractTool} tool
     * @returns {Container}
     */
    _cellForModTool(tool) {
        return this._cells[this._coreTools.length + this._modTools.indexOf(tool)];
    }

    /**
     * The mod-tool slot index whose rest position is nearest (centerX, centerY).
     * @private
     * @param {number} centerX
     * @param {number} centerY
     * @returns {number}
     */
    _nearestModToolIndex(centerX, centerY) {
        let best = 0;
        let bestDistance = Infinity;
        for (let i = 0; i < this._modTools.length; i += 1) {
            const position = this._slotPosition(1 + this._coreTools.length + i);
            const dx = (position.x + SLOT_SIZE / 2) - centerX;
            const dy = (position.y + SLOT_SIZE / 2) - centerY;
            const distance = dx * dx + dy * dy;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = i;
            }
        }
        return best;
    }

    /**
     * Snaps every mod-tool cell, including the dragged one's now-icon-less slot, to its rest
     * position under the working order.
     * @private
     * @param {object} drag
     */
    _layoutDragOrder(drag) {
        for (const [i, tool] of drag.order.entries()) {
            const cell = this._cellForModTool(tool);
            const position = this._slotPosition(1 + this._coreTools.length + i);
            cell.x = position.x;
            cell.y = position.y;
        }
    }

    /**
     * Live-updates every mod-tool cell's number badge (including the dragged one) to match the
     * working order's current hotkey slots, so the badges track the drag in real time.
     * @private
     * @param {object} drag
     */
    _refreshDragBadges(drag) {
        for (const [i, tool] of drag.order.entries()) {
            const badge = this._cellForModTool(tool)._badge;
            if (badge == null) {
                continue;
            }
            const shortcut = this._shortcutForIndex(i);
            badge.text = shortcut === null ? "" : shortcut;
        }
    }

    /**
     * Reattaches the dragged icon to its slot (already at its final rest position via
     * {@link _layoutDragOrder}) and, if the order changed, commits it via {@link onReorder}.
     * @private
     */
    _endDrag() {
        const drag = this._dragState;
        this._dragState = null;
        drag.icon.scale.set(drag.iconBaseScale);
        drag.icon.position.set(SLOT_SIZE / 2, SLOT_SIZE / 2);
        this._cellForModTool(drag.tool).addChild(drag.icon);
        const changed = drag.order.some((tool, i) => tool !== this._modTools[i]);
        if (changed && this._onReorder !== null) {
            this._onReorder(drag.order);
        }
    }

    /**
     * Aborts an in-progress reorder drag without committing it, detaching its window-level
     * tracking and destroying its detached icon; used when the tool list is about to be rebuilt
     * out from under the dragged cell.
     * @private
     */
    _cancelDrag() {
        if (this._dragState === null) {
            return;
        }
        this._dragState.detachDrag();
        this._dragState.icon.destroy();
        this._dragState = null;
    }

    /**
     * Builds the "no tool" cell: an inspect icon that deselects on tap.
     * @private
     * @returns {Container}
     */
    _createNoneCell() {
        const slot = this._createSlot("Inspect", "Q", (slot) => this._addSprite(slot, "inspect/1x1"));
        trackTap(slot, () => {
            Haptics.tap();
            this.setActiveTool(null);
        }, {stopNativePropagation: true});
        return slot;
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
        slot._icon = icon;
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
        // Grows the picked-up icon into its lifted scale while a reorder drag is in progress.
        if (this._dragState !== null) {
            const scale = this._dragState.scaleTween.advance(this._app.ticker.deltaMS);
            this._dragState.icon.scale.set(this._dragState.iconBaseScale * scale);
        }
        // Collapsed panel top: its top row sits above the bottom margin, rows below spill off-screen.
        const collapsedTop = this._app.screen.height - MARGIN_BOTTOM - PANEL_PADDING - cellHeight();
        const offset = this._slide.advance(this._app.ticker.deltaMS);

        // Center the panel.
        const panelX = (this._viewport.screenWidth - this._panelWidth) / 2;
        this._panel.position.set(panelX, collapsedTop - offset);
    }
}
