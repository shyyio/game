
import Mouse from "@/client/Mouse.js";
import Keyboard from "@/client/Keyboard.js";

// Number keys 1-9 select the toolbar tool at that position (1 = first tool).
const TOOL_HOTKEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export class InputHandler {

    /**
     * @param {ModRegistry} modRegistry
     * @param {object} toolbarState - Vue reactive object with { activeTool, tools }
     */
    constructor(modRegistry, toolbarState) {
        this.modRegistry = modRegistry;
        this._toolbarState = toolbarState;

        this._onMiniMenuEntryClick = null;
        this._onInspect = null;

        // The tool that last received onTileEnter, so its ghost preview can be
        // cleared on tool change even if the cursor hasn't moved.
        this._previewTool = null;
        this._hoverTileX = null;
        this._hoverTileY = null;
        // Map mode (zoomed far out) temporarily deactivates the active tool.
        this._mapMode = false;
    }

    get activeTool() {
        // In map mode the tool is deactivated without clearing the toolbar
        // selection, so the cursor acts as if nothing were selected: no placement,
        // no drag, no ghost preview. (The mini-menu is suppressed too — see _handleContextGesture.)
        if (this._mapMode) {
            return null;
        }
        return this._toolbarState.activeTool;
    }

    init() {
        Mouse.onTap((tileX, tileY) => {
            if (this.activeTool == null) {
                return;
            }
            this.activeTool.onTap(tileX, tileY);
        });

        Mouse.onDragStart((tileX, tileY) => {
            if (this.activeTool == null) {
                return;
            }
            this.activeTool.onDragStart(tileX, tileY);
        });

        Mouse.onTileDrag((tileX, tileY, direction) => {
            if (this.activeTool == null) {
                return;
            }
            this.activeTool.onDragTile(tileX, tileY, direction);
        });

        Mouse.onTileEnter((tileX, tileY) => {
            this._enterTile(tileX, tileY);
        });

        Mouse.onTileExit((tileX, tileY) => {
            if (this.activeTool == null) {
                this._emitInspect(null, null);
                return;
            }
            this.activeTool.onTileExit(tileX, tileY);
            this._previewTool = null;
        });

        Mouse.onLongPress((tileX, tileY, screenX, screenY) => {
            this._handleContextGesture(tileX, tileY, screenX, screenY);
        });

        Keyboard.on("r", () => {
            this._rotateActiveTool(1);
        });

        Keyboard.on("q", () => {
            this._clearActiveTool();
        });

        TOOL_HOTKEYS.forEach((key, index) => {
            Keyboard.on(key, () => {
                this._selectTool(index);
            });
        });
    }

    /**
     * @param {function(tileX: number, tileY: number, screenX: number, screenY: number, onClose: function(): void)} callback
     */
    onMiniMenuEntryClick(callback) {
        this._onMiniMenuEntryClick = callback;
    }

    /**
     * Registers the inspect-hover handler (entered tile while tool-less, or null on clear).
     * @param {function(tileX: number|null, tileY: number|null)} callback
     */
    onInspect(callback) {
        this._onInspect = callback;
    }

    /**
     * Clears the active tool's hover preview when the cursor isn't moving (e.g. on tool change).
     */
    clearToolPreview() {
        if (this._previewTool == null) {
            return;
        }
        this._previewTool.onTileExit(this._hoverTileX, this._hoverTileY);
        this._previewTool = null;
    }

    /**
     * Clears the inspect-hover affordance when the cursor isn't moving (e.g. on tool select).
     */
    clearInspect() {
        this._emitInspect(null, null);
    }

    /**
     * Enters/leaves map mode, which deactivates the active tool (activeTool reads
     * null) and disables hover without clearing the toolbar selection.
     * @param {boolean} mapMode
     * @returns {void}
     */
    setMapMode(mapMode) {
        this._mapMode = mapMode;
        Mouse.setHoverEnabled(!mapMode);
    }

    /**
     * Re-runs the hover for the current tile so a tool switch previews immediately; a
     * no-op in map mode.
     */
    refreshHover() {
        if (this._mapMode || this._hoverTileX == null) {
            return;
        }
        this._enterTile(this._hoverTileX, this._hoverTileY);
    }

    /**
     * Routes an entered tile to the active tool's preview, or to the tool-less inspect hover.
     * @private
     */
    _enterTile(tileX, tileY) {
        this._hoverTileX = tileX;
        this._hoverTileY = tileY;
        if (this.activeTool == null) {
            this._emitInspect(tileX, tileY);
            return;
        }
        this._previewTool = this.activeTool;
        this.activeTool.onTileEnter(tileX, tileY);
    }

    /**
     * @private
     */
    _emitInspect(tileX, tileY) {
        if (this._onInspect == null) {
            return;
        }
        this._onInspect(tileX, tileY);
    }

    /**
     * The context gesture (long-press or right-click) opens the mini-menu when no tool is active and
     * not in map mode (where tile interactions are suppressed).
     * @private
     */
    _handleContextGesture(tileX, tileY, screenX, screenY) {
        if (this._mapMode || this.activeTool != null) {
            return;
        }
        this._openMiniMenu(tileX, tileY, screenX, screenY);
    }

    /**
     * Rotates the active tool's facing direction one step clockwise and refreshes
     * its hover ghost in place.
     */
    rotateRight() {
        this._rotateActiveTool(1);
    }

    /**
     * Rotates the active tool's facing direction by `rotation` clockwise steps and
     * refreshes its hover ghost in place.
     * @private
     * @param {number} rotation - clockwise quarter-turns to apply
     */
    _rotateActiveTool(rotation) {
        if (this.activeTool == null) {
            return;
        }
        this.activeTool.rotate(rotation);
        if (this._hoverTileX != null) {
            this.activeTool.onTileEnter(this._hoverTileX, this._hoverTileY);
        }
    }

    /**
     * Deselects the active tool; the toolbar watcher reacts.
     * @private
     */
    _clearActiveTool() {
        this._toolbarState.activeTool = null;
    }

    /**
     * Selects the toolbar tool at `index` (number-key hotkey), if one exists there.
     * @private
     */
    _selectTool(index) {
        const tools = this._toolbarState.tools;
        if (index >= tools.length) {
            return;
        }
        this._toolbarState.activeTool = tools[index];
    }

    /**
     * @private
     */
    _openMiniMenu(tileX, tileY, screenX, screenY) {
        if (this._onMiniMenuEntryClick == null) {
            console.trace("Mini menu opened before a click handler was registered");
            return;
        }
        // Pin the inspect highlight to the menu's tile and freeze hover so it stays put
        // while the menu is open. On close, clear it and resume hover from the current
        // tile so selecting an entry doesn't immediately re-inspect under the cursor.
        Mouse.setHoverEnabled(false);
        this._emitInspect(tileX, tileY);
        this._onMiniMenuEntryClick(tileX, tileY, screenX, screenY, () => {
            this._emitInspect(null, null);
            Mouse.resumeHoverOnMove();
        });
    }
}
