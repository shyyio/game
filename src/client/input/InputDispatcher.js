import Mouse from "@/client/input/Mouse.js";
import Keyboard from "@/client/input/Keyboard.js";
import {AbstractTool} from "@/client/input/AbstractTool.js";
import {KEYBINDING_ERASER, KEYBINDING_TOOL_SLOTS} from "@/common/KeybindingEntry.js";

// Bindings the core tools select on, matched against each core tool's declared `keybinding`.
const CORE_TOOL_KEYBINDINGS = [KEYBINDING_ERASER];

export class InputDispatcher {

    /**
     * @param {ToolbarLayer} toolbar - the pixi tool bar, owning the tool list and active selection
     * @param {KeybindingCache} keybindings
     */
    constructor(toolbar, keybindings) {
        this._toolbar = toolbar;
        this._keybindings = keybindings;

        this._onObjectTap = null;
        this._onObjectHold = null;
        this._onInspect = null;
        this._onMapHover = null;
        this._onMapTap = null;

        // The tool that last received onTileEnter, so its ghost preview can be
        // cleared on tool change even if the cursor hasn't moved.
        this._previewTool = null;
        this._hoverTileX = null;
        this._hoverTileY = null;
        // Map mode (zoomed far out) temporarily deactivates the active tool.
        this._isMapMode = false;
        // Keyboard bindings registered in init(), unbound in destroy() so a stale InputDispatcher from
        // a torn-down Game mount doesn't keep driving a destroyed toolbar/tool/draw layer.
        this._keyboardBindings = [];
        // Rebindable actions registered in init(), released the same way.
        this._keybindingBindings = [];
    }

    /**
     * @returns {AbstractTool|null}
     */
    get activeTool() {
        // In map mode the tool is deactivated without clearing the toolbar
        // selection, so the cursor acts as if nothing were selected: no placement,
        // no drag, no ghost preview.
        if (this._isMapMode) {
            return null;
        }
        return this._toolbar.activeTool;
    }

    /**
     * Whether a drag belongs to the active tool rather than to the viewport's pan.
     * @private
     * @returns {boolean}
     */
    _isPaintingTool() {
        const tool = this.activeTool;
        return tool != null && tool.paintsOnDrag;
    }

    init() {
        Mouse.onTap((tileX, tileY) => {
            if (this._isMapMode) {
                return;
            }
            if (this.activeTool == null) {
                this._notifyObjectTap(tileX, tileY);
                return;
            }
            this.activeTool.onTap(tileX, tileY);
        });

        // Chunk selection rides the press (a pan's start included), not the release.
        Mouse.onPress((tileX, tileY, shiftKey) => {
            if (this._isMapMode) {
                this._notifyMapTap(tileX, tileY, shiftKey);
            }
        });

        Mouse.onDragStart((tileX, tileY) => {
            if (!this._isPaintingTool()) {
                return;
            }
            this.activeTool.onDragStart(tileX, tileY);
        });

        Mouse.onTileDrag((tileX, tileY, direction) => {
            if (!this._isPaintingTool()) {
                return;
            }
            this.activeTool.onDragTile(tileX, tileY, direction);
        });

        Mouse.onTileEnter((tileX, tileY) => {
            this._enterTile(tileX, tileY);
        });

        Mouse.onTileExit((tileX, tileY) => {
            // Map-mode hover persists across exits; the next enter retargets it.
            if (this._isMapMode) {
                return;
            }
            if (this.activeTool == null) {
                this._notifyInspect(null, null);
                return;
            }
            this.activeTool.onTileExit(tileX, tileY);
            this._previewTool = null;
        });

        Mouse.onLongPress((tileX, tileY, screenX, screenY) => {
            this._onContextGesture(tileX, tileY, screenX, screenY);
        });

        this._onKey("r", () => {
            this._rotateActiveTool(1);
        });

        this._onKey("Tab", (event) => {
            // Let Tab cycle focus normally inside dialogs/form controls (e.g. Settings).
            if (InputDispatcher._isEditableTarget(event.target)) {
                return;
            }
            // Otherwise stop Tab from cycling focus off the canvas.
            event.preventDefault();
            this._toolbar.toggleDrawer();
        });

        // A slot binding selects the mod tool at that position (slot 1 = first mod tool).
        for (const [index, keybinding] of KEYBINDING_TOOL_SLOTS.entries()) {
            this._onKeybinding(keybinding, () => {
                this._selectTool(index);
            });
        }

        for (const keybinding of CORE_TOOL_KEYBINDINGS) {
            this._onKeybinding(keybinding, () => {
                this._selectCoreTool(keybinding);
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
     * Binds a rebindable action and records it so {@link destroy} can unbind it.
     * @private
     */
    _onKeybinding(keybinding, callback) {
        this._keybindings.on(keybinding, callback);
        this._keybindingBindings.push([keybinding, callback]);
    }

    /**
     * Unbinds every listener registered in {@link init}.
     * @returns {void}
     */
    destroy() {
        for (const [key, callback] of this._keyboardBindings) {
            Keyboard.off(key, callback);
        }
        this._keyboardBindings = [];
        for (const [keybinding, callback] of this._keybindingBindings) {
            this._keybindings.off(keybinding, callback);
        }
        this._keybindingBindings = [];
    }

    /**
     * Registers the object-tap handler (left click on a tile while tool-less).
     * @param {function(tileX: number, tileY: number)} callback
     */
    onObjectTap(callback) {
        this._onObjectTap = callback;
    }

    /**
     * Registers the object-hold handler (context gesture on a tile while tool-less).
     * @param {function(tileX: number, tileY: number)} callback
     */
    onObjectHold(callback) {
        this._onObjectHold = callback;
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
     * @param {function(tileX: number, tileY: number, shiftKey: boolean)} callback
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
        this._notifyInspect(null, null);
    }

    /**
     * Enters/leaves map mode: activeTool reads null without clearing the toolbar
     * selection; hover reroutes to the map-hover handler.
     * @param {boolean} isMapMode
     * @returns {void}
     */
    setMapMode(isMapMode) {
        if (this._isMapMode === isMapMode) {
            return;
        }
        this._isMapMode = isMapMode;
        if (isMapMode) {
            if (this._hoverTileX != null) {
                this._notifyMapHover(this._hoverTileX, this._hoverTileY);
            }
        } else {
            this._notifyMapHover(null, null);
        }
    }

    /**
     * Re-runs the hover for the current tile so a tool switch previews immediately; a
     * no-op in map mode.
     */
    resyncHover() {
        if (this._isMapMode || this._hoverTileX == null) {
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
        if (this._isMapMode) {
            this._notifyMapHover(tileX, tileY);
            return;
        }
        if (this.activeTool == null) {
            this._notifyInspect(tileX, tileY);
            return;
        }
        this._previewTool = this.activeTool;
        this.activeTool.onTileEnter(tileX, tileY);
    }

    /**
     * @private
     */
    _notifyObjectTap(tileX, tileY) {
        if (this._onObjectTap == null) {
            return;
        }
        this._onObjectTap(tileX, tileY);
    }

    /**
     * @private
     */
    _notifyObjectHold(tileX, tileY) {
        if (this._onObjectHold == null) {
            return;
        }
        this._onObjectHold(tileX, tileY);
    }

    /**
     * @private
     */
    _notifyInspect(tileX, tileY) {
        if (this._onInspect == null) {
            return;
        }
        this._onInspect(tileX, tileY);
    }

    /**
     * @private
     */
    _notifyMapHover(tileX, tileY) {
        if (this._onMapHover == null) {
            return;
        }
        this._onMapHover(tileX, tileY);
    }

    /**
     * @private
     */
    _notifyMapTap(tileX, tileY, shiftKey) {
        if (this._onMapTap == null) {
            return;
        }
        this._onMapTap(tileX, tileY, shiftKey);
    }

    /**
     * The context gesture (long-press or right-click): no-op in map mode, offered to the mods'
     * bespoke content while tool-less, otherwise deselects the active tool.
     * @private
     */
    _onContextGesture(tileX, tileY, screenX, screenY) {
        if (this._isMapMode) {
            return;
        }
        if (this.activeTool == null) {
            this._notifyObjectHold(tileX, tileY);
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
     * Selects the core tool declaring `keybinding`, if present.
     * @private
     */
    _selectCoreTool(keybinding) {
        const tool = this._toolbar.coreTools.find(candidate => candidate.keybinding === keybinding);
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
