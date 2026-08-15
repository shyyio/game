
import Mouse from "@/client/input/Mouse.js";
import Keyboard from "@/client/input/Keyboard.js";
import {AbstractTool} from "@/client/input/AbstractTool.js";

// Number keys 1-9 select the mod tool at that position (1 = first mod tool); core tools use
// their own letter hotkeys instead.
const TOOL_HOTKEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

// Letter keys bound for core tools; the pressed key is matched against each core tool's `hotkey`.
const CORE_TOOL_HOTKEYS = ["e"];

export class InputHandler {

    /**
     * @param {ToolbarLayer} toolbar - the pixi tool bar, owning the tool list and active selection
     */
    constructor(toolbar) {
        this._toolbar = toolbar;

        this._onObjectTap = null;
        this._onInspect = null;
        this._onMapHover = null;
        this._onMapTap = null;

        // The tool that last received onTileEnter, so its ghost preview can be
        // cleared on tool change even if the cursor hasn't moved.
        this._previewTool = null;
        this._hoverTileX = null;
        this._hoverTileY = null;
        // Map mode (zoomed far out) temporarily deactivates the active tool.
        this._mapMode = false;
        // Keyboard bindings registered in init(), unbound in destroy() so a stale InputHandler from
        // a torn-down Game mount doesn't keep driving a destroyed toolbar/tool/draw layer.
        this._keyboardBindings = [];
    }

    /**
     * @returns {AbstractTool|null}
     */
    get activeTool() {
        // In map mode the tool is deactivated without clearing the toolbar
        // selection, so the cursor acts as if nothing were selected: no placement,
        // no drag, no ghost preview. (The mini-menu is suppressed too — see _handleContextGesture.)
        if (this._mapMode) {
            return null;
        }
        return this._toolbar.activeTool;
    }

    /**
     * Whether a drag belongs to the active tool rather than to the viewport's pan.
     * @private
     * @returns {boolean}
     */
    _paintingTool() {
        const tool = this.activeTool;
        return tool != null && tool.paintsOnDrag;
    }

    init() {
        Mouse.onTap((tileX, tileY) => {
            if (this._mapMode) {
                return;
            }
            if (this.activeTool == null) {
                this._emitObjectTap(tileX, tileY);
                return;
            }
            this.activeTool.onTap(tileX, tileY);
        });

        // Chunk selection rides the press (a pan's start included), not the release.
        Mouse.onPress((tileX, tileY) => {
            if (this._mapMode) {
                this._emitMapTap(tileX, tileY);
            }
        });

        Mouse.onDragStart((tileX, tileY) => {
            if (!this._paintingTool()) {
                return;
            }
            this.activeTool.onDragStart(tileX, tileY);
        });

        Mouse.onTileDrag((tileX, tileY, direction) => {
            if (!this._paintingTool()) {
                return;
            }
            this.activeTool.onDragTile(tileX, tileY, direction);
        });

        Mouse.onTileEnter((tileX, tileY) => {
            this._enterTile(tileX, tileY);
        });

        Mouse.onTileExit((tileX, tileY) => {
            // Map-mode hover persists across exits; the next enter retargets it.
            if (this._mapMode) {
                return;
            }
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

        this._onKey("r", () => {
            this._rotateActiveTool(1);
        });

        this._onKey("Tab", (event) => {
            // Let Tab cycle focus normally inside dialogs/form controls (e.g. Settings).
            if (InputHandler._isEditableTarget(event.target)) {
                return;
            }
            // Otherwise stop Tab from cycling focus off the canvas.
            event.preventDefault();
            this._toolbar.toggleDrawer();
        });

        for (const [index, key] of TOOL_HOTKEYS.entries()) {
            this._onKey(key, () => {
                this._selectTool(index);
            });
        }

        // Core tools bind their declared letter hotkey (e.g. the eraser's "e").
        for (const key of CORE_TOOL_HOTKEYS) {
            this._onKey(key, () => {
                this._selectCoreTool(key);
            });
        }
    }

    /**
     * Binds a Keyboard callback and records it so {@link destroy} can unbind it.
     * @private
     */
    _onKey(key, callback) {
        Keyboard.on(key, callback);
        this._keyboardBindings.push([key, callback]);
    }

    /**
     * Unbinds every Keyboard listener registered in {@link init}.
     * @returns {void}
     */
    destroy() {
        for (const [key, callback] of this._keyboardBindings) {
            Keyboard.off(key, callback);
        }
        this._keyboardBindings = [];
    }

    /**
     * Registers the object-tap handler (left click on a tile while tool-less).
     * @param {function(tileX: number, tileY: number)} callback
     */
    onObjectTap(callback) {
        this._onObjectTap = callback;
    }

    /**
     * Registers the inspect-hover handler (entered tile while tool-less, or null on clear).
     * @param {function(tileX: number|null, tileY: number|null)} callback
     */
    onInspect(callback) {
        this._onInspect = callback;
    }

    /**
     * Registers the map-mode hover handler (entered tile, or null when map mode ends).
     * @param {function(tileX: number|null, tileY: number|null)} callback
     */
    onMapHover(callback) {
        this._onMapHover = callback;
    }

    /**
     * Registers the map-mode tap handler (claim selection).
     * @param {function(tileX: number, tileY: number)} callback
     */
    onMapTap(callback) {
        this._onMapTap = callback;
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
     * Enters/leaves map mode: activeTool reads null without clearing the toolbar
     * selection; hover reroutes to the map-hover handler.
     * @param {boolean} mapMode
     * @returns {void}
     */
    setMapMode(mapMode) {
        if (this._mapMode === mapMode) {
            return;
        }
        this._mapMode = mapMode;
        if (mapMode) {
            if (this._hoverTileX != null) {
                this._emitMapHover(this._hoverTileX, this._hoverTileY);
            }
        } else {
            this._emitMapHover(null, null);
        }
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
     * Routes an entered tile to the map-mode chunk hover, the active tool's preview,
     * or the tool-less inspect hover.
     * @private
     */
    _enterTile(tileX, tileY) {
        this._hoverTileX = tileX;
        this._hoverTileY = tileY;
        if (this._mapMode) {
            this._emitMapHover(tileX, tileY);
            return;
        }
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
    _emitObjectTap(tileX, tileY) {
        if (this._onObjectTap == null) {
            return;
        }
        this._onObjectTap(tileX, tileY);
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
     * @private
     */
    _emitMapHover(tileX, tileY) {
        if (this._onMapHover == null) {
            return;
        }
        this._onMapHover(tileX, tileY);
    }

    /**
     * @private
     */
    _emitMapTap(tileX, tileY) {
        if (this._onMapTap == null) {
            return;
        }
        this._onMapTap(tileX, tileY);
    }

    /**
     * The context gesture (long-press or right-click): no-op in map mode or when no tool is
     * active, otherwise deselects the active tool.
     * @private
     */
    _handleContextGesture(tileX, tileY, screenX, screenY) {
        if (this._mapMode || this.activeTool == null) {
            return;
        }
        this._clearActiveTool();
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
     * Whether `target` is a form control or lives inside a dialog, where Tab should
     * keep its native focus-cycling behavior instead of toggling the toolbar drawer.
     * @param {EventTarget} target
     * @returns {boolean}
     * @private
     */
    static _isEditableTarget(target) {
        if (!(target instanceof Element)) {
            return false;
        }
        if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
            return true;
        }
        if (target.isContentEditable) {
            return true;
        }
        return target.closest("[role=\"dialog\"]") != null;
    }
}
