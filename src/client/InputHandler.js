
import Mouse from "@/client/Mouse.js";

export class InputHandler {

    /**
     * @param {ModSet} modSet
     * @param {object} toolbarState - Vue reactive object with { activeTool }
     */
    constructor(modSet, toolbarState) {
        this.modSet = modSet;
        this._toolbarState = toolbarState;

        this._onMiniMenuEntryClick = null;
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

        Mouse.onRightClick((tileX, tileY, screenX, screenY) => {
            this._openMiniMenu(tileX, tileY, screenX, screenY);
        });

        Mouse.onLongPress((tileX, tileY, screenX, screenY) => {
            this._openMiniMenu(tileX, tileY, screenX, screenY);
        });
    }

    /**
     * @param {function(tileX: number, tileY: number, screenX: number, screenY: number)} callback
     */
    onMiniMenuEntryClick(callback) {
        this._onMiniMenuEntryClick = callback;
    }

    _openMiniMenu(tileX, tileY, screenX, screenY) {
        if (this._onMiniMenuEntryClick == null) {
            console.trace("Mini menu opened before a click handler was registered");
            return;
        }
        this._onMiniMenuEntryClick(tileX, tileY, screenX, screenY);
    }
}
