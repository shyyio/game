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
        this._drawerButton = null;
        this._drawerOpen = false;
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
        this._closeDrawer();
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
        this._closeDrawer();
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

        // The toggle sits outside the sliding panel (a direct child), so it stays put while the
        // drawer slides.
        this._drawerButton = this._createDrawerButton();
        this.addChild(this._drawerButton);

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

        square.on("pointerdown", (e) => {
            e.nativeEvent.stopPropagation();
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
        if (this._drawerOpen) {
            this._closeDrawer();
        } else {
            this._openDrawer();
        }
    }

    /**
     * Opens the drawer and installs the click-off listener that closes it on a press elsewhere. The
     * press that opened it is stopped before it bubbles to the window, so it doesn't self-close.
     * @private
     */
    _openDrawer() {
        this._drawerOpen = true;
        this._drawBg(this._drawerButton._bg, true);
        // Slide up with a slight overshoot as the rows spring into view.
        this._slide.to(this._slideDistance, easeOutBack);
        this._clickOffListener = () => this._closeDrawer();
        window.addEventListener("pointerdown", this._clickOffListener);
    }

    /**
     * Closes the drawer and removes the click-off listener (a no-op when already closed).
     * @private
     */
    _closeDrawer() {
        if (!this._drawerOpen) {
            return;
        }
        this._drawerOpen = false;
        if (this._drawerButton !== null) {
            this._drawBg(this._drawerButton._bg, false);
        }
        // Slide back down, accelerating in — no overshoot that would dip the bar off-screen.
        this._slide.to(0, easeInCubic);
        window.removeEventListener("pointerdown", this._clickOffListener);
        this._clickOffListener = null;
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

        // Desktop centers the panel with the toggle to its left; mobile centers the whole
        // button + panel group so the panel shifts right to make room.
        const buttonLead = SQUARE_SIZE + CELL_GAP;
        const panelX = MOBILE
            ? (this._viewport.screenWidth - buttonLead - this._panelWidth) / 2 + buttonLead
            : (this._viewport.screenWidth - this._panelWidth) / 2;
        this._panel.position.set(panelX, collapsedTop - offset);
        // Static: pinned to the resting top-row height, unaffected by the slide offset.
        this._drawerButton.position.set(panelX - buttonLead, collapsedTop + PANEL_PADDING);
    }
}
