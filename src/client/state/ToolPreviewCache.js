import {ListenerList} from "@/common/ListenerList.js";

/**
 * A selection being spanned: its fixed corner in fractional tiles and the tool spanning it.
 */
export class SelectionPreviewEntry {

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} toolId
     */
    constructor(tileX, tileY, toolId) {
        this.tileX = tileX;
        this.tileY = tileY;
        this.toolId = toolId;
    }
}

/**
 * What the active tool previews in the world: the selection being spanned and the blueprint held
 * to paste, for mods mirroring them.
 */
export class ToolPreviewCache {

    constructor() {
        /** @type {SelectionPreviewEntry|null} */
        this._selection = null;
        /** @type {Blueprint|null} */
        this._paste = null;
        this._selectionListeners = new ListenerList();
        this._pasteListeners = new ListenerList();
    }

    /**
     * @returns {SelectionPreviewEntry|null}
     */
    get selection() {
        return this._selection;
    }

    /**
     * The blueprint as turned by the player, null while nothing is held to paste.
     * @returns {Blueprint|null}
     */
    get paste() {
        return this._paste;
    }

    /**
     * @param {SelectionPreviewEntry|null} selection
     * @returns {void}
     */
    setSelection(selection) {
        if (selection === this._selection) {
            return;
        }
        this._selection = selection;
        this._selectionListeners.notify(selection);
    }

    /**
     * @param {Blueprint|null} blueprint
     * @returns {void}
     */
    setPaste(blueprint) {
        if (blueprint === this._paste) {
            return;
        }
        this._paste = blueprint;
        this._pasteListeners.notify(blueprint);
    }

    /**
     * @param {function(SelectionPreviewEntry|null): void} listener
     * @returns {function(): void} unsubscribe
     */
    onSelectionChange(listener) {
        return this._selectionListeners.add(listener);
    }

    /**
     * @param {function(Blueprint|null): void} listener
     * @returns {function(): void} unsubscribe
     */
    onPasteChange(listener) {
        return this._pasteListeners.add(listener);
    }
}
