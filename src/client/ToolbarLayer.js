import {Container, Graphics, Sprite, Text, isMobile} from "pixi.js";
import Haptics from "@/client/Haptics.js";
import {GAME_FONT} from "@/client/constants.js";
import {easeOutBack, easeInCubic} from "@/client/easing.js";
import {Tween} from "@/client/Tween.js";

const SQUARE_SIZE = 56;
const SQUARE_RADIUS = 6;
// Inset of the icon sprite from the square's edges.
const ICON_PADDING = 3;
const LABEL_GAP = 6;
const LABEL_SIZE = 15;
// Reserved height for the label under each square, so cells align regardless of text.
const LABEL_HEIGHT = 16;
const CELL_GAP = 18;
const ROW_GAP = 12;
const MARGIN_BOTTOM = 6;
// Tools shown on the visible top row; the rest overflow into the drawer rows below.
const MAX_BAR_TOOLS = 3;
// Inset of the cells from the enclosing panel edge, and the panel's corner radius.
const PANEL_PADDING = 10;
const PANEL_RADIUS = 5;
// Duration of the drawer open/close slide tween.
const SLIDE_DURATION_MS = 230;
// Upper bound on the open-slide overshoot as a fraction of the slide; the panel bottom is bled by
// this much (plus a fixed cushion) so the overshoot never exposes its bottom edge.
const OPEN_OVERSHOOT = 0.2;
const DRAWER_BOTTOM_PAD = 12;
// Pointer travel (px) past which a press on the panel is a drawer drag, not a tool tap.
const DRAG_THRESHOLD = 6;

const CELL_HEIGHT = SQUARE_SIZE + LABEL_GAP + LABEL_HEIGHT;

const MOBILE = isMobile.any;

/**
 * Static bottom-center tool toolbar: a screen-space HUD sibling of the viewport (on app.stage),
 * not a viewport child, so it never pans or zooms. The whole bar is one panel arranged as a grid:
 * the top row (a drawer toggle button, a "no tool" cursor cell, plus the first {@link MAX_BAR_TOOLS}
 * tools) rests at the bottom edge while the overflow rows sit off-screen below it. Pressing the
 * button slides the panel up to reveal those rows. Each tool is a square holding its icon sprite
 * with its label underneath; tapping one toggles it as the active tool.
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
        this._activeTool = null;
        this._onChange = null;
        // One cell Container per tool, parallel to _tools, so highlights update in place.
        this._cells = [];
        // Always-present top-row cell that selects "no tool" (activeTool null).
        this._noneCell = null;
        // Desktop-only toggle; mobile opens the drawer by dragging the panel.
        this._drawerButton = null;
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

        // The single sliding rectangle: its background plus the toggle button and every cell.
        this._panel = new Container();
        this.addChild(this._panel);
        this._panelBg = new Graphics();
        // Swallow presses on the bar chrome so they neither place a tile in the world beneath nor
        // register as a click-off that closes the drawer.
        this._panelBg.eventMode = "static";
        this._panelBg.on("pointerdown", (e) => e.nativeEvent.stopPropagation());
        this._panel.addChild(this._panelBg);

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
     * Registers the callback invoked whenever the active tool changes (click or programmatic).
     * @param {function(): void} callback
     * @returns {void}
     */
    onChange(callback) {
        this._onChange = callback;
    }

    /**
     * Rebuilds the panel grid for a new tool list, dropping the active selection if it's gone.
     * @param {AbstractTool[]} tools
     * @returns {void}
     */
    setTools(tools) {
        this._tools = tools;
        this._rebuild();
        if (!tools.includes(this._activeTool)) {
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
     * Tears down the old squares and lays the grid out row-major in the panel: the "no tool" cell,
     * then the tools. The drawer button is a static sibling outside the panel, positioned by _layout.
     * @private
     */
    _rebuild() {
        // Detach any click-off listener and snap to closed before the old squares are destroyed.
        this._setDrawerOpen(false);
        this._slide.reset(0);
        [this._drawerButton, this._noneCell, ...this._cells].forEach(square => {
            if (square !== null) {
                square.destroy({children: true});
            }
        });

        this._noneCell = this._createNoneCell();
        this._cells = this._tools.map(tool => this._createCell(tool));

        // Row-major grid; the top row is the none cell + the first MAX_BAR_TOOLS tools.
        const squares = [this._noneCell, ...this._cells];
        this._columns = MAX_BAR_TOOLS + 1;
        this._rowCount = Math.ceil(squares.length / this._columns);
        squares.forEach((square, i) => {
            square.x = PANEL_PADDING + (i % this._columns) * (SQUARE_SIZE + CELL_GAP);
            square.y = PANEL_PADDING + Math.floor(i / this._columns) * (CELL_HEIGHT + ROW_GAP);
            this._panel.addChild(square);
        });

        // Desktop toggle sits outside the sliding panel (a direct child), so it stays put while the
        // drawer slides; mobile has no button and drags the panel instead.
        this._drawerButton = MOBILE ? null : this._createDrawerButton();
        if (this._drawerButton !== null) {
            this.addChild(this._drawerButton);
        }

        this._panelWidth = this._columns * SQUARE_SIZE + (this._columns - 1) * CELL_GAP + PANEL_PADDING * 2;
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
        this._panelBg.clear()
            .roundRect(0, 0, this._panelWidth, PANEL_PADDING + content + bottomBleed, PANEL_RADIUS)
            .fill({color: 0xe6ddcc, alpha: 0.95})
            .stroke({color: 0xbbb2a0, width: 1});
    }

    /**
     * Builds an interactive square (background + optional label + icon) with the given press handler.
     * The press is stopped so it neither pans the viewport nor places a tile beneath.
     * @private
     * @param {string|null} label
     * @param {function(Container): void} addIcon - adds the square's icon
     * @param {function(): void} onPress
     * @returns {Container}
     */
    _createSquare(label, addIcon, onPress) {
        const square = new Container();
        square.eventMode = "static";
        square.cursor = "pointer";

        square._bg = new Graphics();
        square.addChild(square._bg);
        addIcon(square);

        if (label !== null) {
            const text = new Text({
                text: label,
                style: {fontFamily: GAME_FONT, fontSize: LABEL_SIZE, fill: 0x000000},
            });
            text.x = (SQUARE_SIZE - text.width) / 2;
            text.y = SQUARE_SIZE + LABEL_GAP;
            square.addChild(text);
        }

        // Swallow the press so it neither pans the viewport nor places a tile beneath.
        square.on("pointerdown", (e) => e.nativeEvent.stopPropagation());
        // Act on release, unless the gesture became a drawer drag (then it's not a tap).
        square.on("pointerup", () => {
            if (this._dragMoved) {
                return;
            }
            Haptics.tap();
            onPress();
        });
        return square;
    }

    /**
     * Builds one tool cell: its icon sprite, toggling the tool on tap.
     * @private
     * @param {AbstractTool} tool
     * @returns {Container}
     */
    _createCell(tool) {
        return this._createSquare(
            tool.label,
            (square) => this._addSprite(square, tool.textureName),
            () => this.setActiveTool(tool === this._activeTool ? null : tool),
        );
    }

    /**
     * Builds the "no tool" cell: an inspect icon that deselects on tap.
     * @private
     * @returns {Container}
     */
    _createNoneCell() {
        return this._createSquare(
            "Inspect",
            (square) => this._addSprite(square, "inspect/1x1"),
            () => this.setActiveTool(null),
        );
    }

    /**
     * Builds the drawer toggle: a blank square (lit while open) that toggles the drawer on tap.
     * @private
     * @returns {Container}
     */
    _createDrawerButton() {
        const button = this._createSquare(null, () => {}, () => this._toggleDrawer());
        this._drawBg(button._bg, false);
        return button;
    }

    /**
     * Adds a texture's sprite centered and scaled to fit the square.
     * @private
     * @param {Container} square
     * @param {string} textureName
     */
    _addSprite(square, textureName) {
        const texture = this.textureRegistry.require(textureName);
        const icon = new Sprite(texture);
        icon.anchor = 0.5;
        const fit = SQUARE_SIZE - ICON_PADDING * 2;
        icon.scale = Math.min(fit / texture.width, fit / texture.height);
        icon.position.set(SQUARE_SIZE / 2, SQUARE_SIZE / 2);
        square.addChild(icon);
    }

    /**
     * @private
     */
    _toggleDrawer() {
        this._setDrawerOpen(!this._drawerOpen);
    }

    /**
     * Opens or closes the drawer: tweens the slide (overshoot open / accelerate closed), lights the
     * button, and installs/removes the click-off listener. The press that toggles it is stopped
     * before it bubbles to the window, so it doesn't self-close.
     * @private
     * @param {boolean} open
     */
    _setDrawerOpen(open) {
        this._drawerOpen = open;
        if (this._drawerButton !== null) {
            this._drawBg(this._drawerButton._bg, open);
        }
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
            this._drawBg(this._noneCell._bg, this._activeTool === null);
        }
        this._cells.forEach((cell, index) => this._drawBg(cell._bg, this._tools[index] === this._activeTool));
    }

    /**
     * Draws a square's background, lit blue when active.
     * @private
     * @param {Graphics} bg
     * @param {boolean} active
     */
    _drawBg(bg, active) {
        bg.clear()
            .roundRect(0, 0, SQUARE_SIZE, SQUARE_SIZE, SQUARE_RADIUS)
            .fill({color: active ? 0xd6ebff : 0xf5f0e6, alpha: 0.92})
            .stroke({color: active ? 0x5bb5ff : 0xbbb2a0, width: active ? 2 : 1});
    }

    /**
     * Centers the panel (and static toggle button) horizontally and advances the slide tween so the
     * rows glide into/out of view; the toggle stays put at the resting top-row height.
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

        // Center the panel; the desktop toggle sits just to its left.
        const panelX = (this._viewport.screenWidth - this._panelWidth) / 2;
        this._panel.position.set(panelX, collapsedTop - offset);
        if (this._drawerButton !== null) {
            // Static: pinned to the resting top-row height, unaffected by the slide offset.
            this._drawerButton.position.set(panelX - CELL_GAP - SQUARE_SIZE, collapsedTop + PANEL_PADDING);
        }
    }
}
