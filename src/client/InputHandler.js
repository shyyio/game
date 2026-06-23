
import Mouse from "@/client/Mouse.js";
import Keyboard from "@/client/keyboard.js";

export class InputHandler {

    /**
     * @param {ModRegistry} modRegistry
     * @param {object} toolbarState - Vue reactive object with { activeTool }
     */
    constructor(modRegistry, toolbarState) {
        this.modRegistry = modRegistry;
        this._toolbarState = toolbarState;

        this._onMiniMenuEntryClick = null;
        this._onDirectionWheel = null;

        // The tool that last received onTileEnter, so its ghost preview can be
        // cleared on tool change even if the cursor hasn't moved.
        this._previewTool = null;
        this._hoverTileX = null;
        this._hoverTileY = null;
    }

    get activeTool() {
        return this._toolbarState.activeTool;
    }

    init() {
        Mouse.onTap((tileX, tileY) => {
            if (this.activeTool == null) {
                return;
            }
            this.activeTool.onTap(tileX, tileY);
        });

        Mouse.onTileDrag((tileX, tileY, direction) => {
            if (this.activeTool == null) {
                return;
            }
            this.activeTool.onDragTile(tileX, tileY, direction);
        });

        Mouse.onTileEnter((tileX, tileY) => {
            this._hoverTileX = tileX;
            this._hoverTileY = tileY;
            if (this.activeTool == null) {
                return;
            }
            this._previewTool = this.activeTool;
            this.activeTool.onTileEnter(tileX, tileY);
        });

        Mouse.onTileExit((tileX, tileY) => {
            if (this.activeTool == null) {
                return;
            }
            this.activeTool.onTileExit(tileX, tileY);
            this._previewTool = null;
        });

        Mouse.onRightClick((tileX, tileY, screenX, screenY) => {
            this._handleContextGesture(tileX, tileY, screenX, screenY);
        });

        Mouse.onLongPress((tileX, tileY, screenX, screenY) => {
            this._handleContextGesture(tileX, tileY, screenX, screenY);
        });

        Keyboard.on("r", () => {
            this._rotateActiveTool();
        });
    }

    /**
     * @param {function(tileX: number, tileY: number, screenX: number, screenY: number)} callback
     */
    onMiniMenuEntryClick(callback) {
        this._onMiniMenuEntryClick = callback;
    }

    /**
     * Registers the handler that opens the radial direction wheel. The handler
     * receives the tile the gesture landed on plus an `onSelect(direction)`
     * callback to invoke once the player picks a direction.
     * @param {function(tileX: number, tileY: number, onSelect: function(Direction))} callback
     */
    onDirectionWheel(callback) {
        this._onDirectionWheel = callback;
    }

    /**
     * Clears any active tool's hover preview (e.g. when the toolbar selection
     * changes), since no onTileExit fires if the cursor stays still.
     */
    clearToolPreview() {
        if (this._previewTool == null) {
            return;
        }
        this._previewTool.onTileExit(this._hoverTileX, this._hoverTileY);
        this._previewTool = null;
    }

    /**
     * A long-press or right-click opens the direction wheel while a tool is
     * active, otherwise the object mini-menu.
     * @private
     */
    _handleContextGesture(tileX, tileY, screenX, screenY) {
        if (this.activeTool != null) {
            this._openDirectionWheel(tileX, tileY);
            return;
        }
        this._openMiniMenu(tileX, tileY, screenX, screenY);
    }

    /**
     * @private
     */
    _openDirectionWheel(tileX, tileY) {
        if (this._onDirectionWheel == null) {
            console.trace("Direction wheel opened before a handler was registered");
            return;
        }
        // The wheel opens mid-press (during the long-press hold). Drop the
        // in-flight gesture so the eventual release — which lands on the modal
        // wheel, not the game — can't be read as a drag afterwards.
        Mouse.cancelInteraction();
        this._onDirectionWheel(tileX, tileY, direction => {
            if (direction == null || this.activeTool == null) {
                return;
            }
            this.activeTool.onLongTap(tileX, tileY, direction);
        });
    }

    /**
     * Rotates the active tool's facing direction one step clockwise and refreshes
     * its hover ghost in place.
     * @private
     */
    _rotateActiveTool() {
        if (this.activeTool == null) {
            return;
        }
        this.activeTool.rotate();
        if (this._hoverTileX != null) {
            this.activeTool.onTileEnter(this._hoverTileX, this._hoverTileY);
        }
    }

    /**
     * @private
     */
    _openMiniMenu(tileX, tileY, screenX, screenY) {
        if (this._onMiniMenuEntryClick == null) {
            console.trace("Mini menu opened before a click handler was registered");
            return;
        }
        this._onMiniMenuEntryClick(tileX, tileY, screenX, screenY);
    }
}
