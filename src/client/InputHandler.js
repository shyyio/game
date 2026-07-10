
import Mouse from "@/client/Mouse.js";
import Keyboard from "@/client/Keyboard.js";

// Number keys 1-9 select the mod tool at that position (1 = first mod tool); core tools use
// their own letter hotkeys instead.
const TOOL_HOTKEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

// Letter keys bound for core tools; the pressed key is matched against each core tool's `hotkey`.
const CORE_TOOL_HOTKEYS = ["e"];

export class InputHandler {

    /**
     * @param {ModRegistry} modRegistry
     * @param {ToolbarLayer} toolbar - the pixi tool bar, owning the tool list and active selection
     */
    constructor(modRegistry, toolbar) {
        this.modRegistry = modRegistry;
        this._toolbar = toolbar;

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
        return this._toolbar.activeTool;
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

        Keyboard.on("i", () => {
            this._toolbar.toggleDrawer();
        });

        TOOL_HOTKEYS.forEach((key, index) => {
            Keyboard.on(key, () => {
                this._selectTool(index);
            });
        });

        // Core tools bind their declared letter hotkey (e.g. the eraser's "e").
        CORE_TOOL_HOTKEYS.forEach(key => {
            Keyboard.on(key, () => {
                this._selectCoreTool(key);
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
     * The context gesture (long-press or right-click), suppressed in map mode: with a tool active it
     * deselects the tool, otherwise it opens the mini-menu.
     * @private
     */
    _handleContextGesture(tileX, tileY, screenX, screenY) {
        if (this._mapMode) {
            return;
        }
        if (this.activeTool != null) {
            this._clearActiveTool();
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
     * Deselects the active tool; the toolbar's change callback reacts.
     * @private
     */
    _clearActiveTool() {
        this._toolbar.setActiveTool(null);
    }

    /**
     * Selects the toolbar tool at `index` (number-key hotkey), if one exists there.
     * @private
     */
    _selectTool(index) {
        const tools = this._toolbar.modTools;
        if (index >= tools.length) {
            return;
        }
        this._toolbar.setActiveTool(tools[index]);
    }

    /**
     * Selects the core tool whose declared `hotkey` matches `key`, if present.
     * @private
     */
    _selectCoreTool(key) {
        const tool = this._toolbar.coreTools.find(t => t.hotkey === key);
        if (tool == null) {
            return;
        }
        this._toolbar.setActiveTool(tool);
    }

    /**
     * @private
     */
    _openMiniMenu(tileX, tileY, screenX, screenY) {
        if (this._onMiniMenuEntryClick == null) {
            console.trace("Mini menu opened before a click handler was registered");
            return;
        }
        // Open first: this closes any prior menu, firing its onClose (which resumes hover
        // and clears the old highlight). Only then pin the inspect highlight to this menu's
        // tile and freeze hover, so a reopen doesn't get its freeze clobbered by the old
        // menu's teardown. On close, clear it and resume hover from the current tile so
        // selecting an entry doesn't immediately re-inspect under the cursor.
        this._onMiniMenuEntryClick(tileX, tileY, screenX, screenY, () => {
            this._emitInspect(null, null);
            Mouse.resumeHoverOnMove();
        });
        Mouse.setHoverEnabled(false);
        this._emitInspect(tileX, tileY);
    }
}
