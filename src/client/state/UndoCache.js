import {Blueprint, BlueprintEntry} from "@/common/Blueprint.js";
import {DeleteBlueprintMessage, PlaceBlueprintMessage} from "@/common/CoreMessages.js";

// Actions kept for undo; the oldest drops off past it.
export const UNDO_DEPTH = 100;

// The placed side of an action that only deleted.
export const NOTHING_PLACED = new Blueprint([]);

/**
 * One player action: the objects it placed and deleted, in world tiles, and the clipboard it found.
 */
class UndoEntry {

    /**
     * @param {Blueprint} placed
     * @param {Blueprint} deleted
     * @param {Blueprint|null} clipboard
     */
    constructor(placed, deleted, clipboard) {
        this.placed = placed;
        this.deleted = deleted;
        this.clipboard = clipboard;
    }
}

/**
 * Placed objects as a blueprint anchored on world tile 0,0.
 * @param {CacheEntry[]} objects
 * @returns {Blueprint}
 */
function buildWorldBlueprint(objects) {
    return new Blueprint(objects.map(object => new BlueprintEntry(object.data.type.objectTypeId, object.tileX, object.tileY, object.data.direction)));
}

/**
 * The player's undo and redo stacks. Undoing an entry deletes what it placed by tile, which the sim
 * resolves in message order after the placement, places back what it deleted, restores its
 * clipboard, and hands its inverse to the other stack.
 */
export class UndoCache {

    /**
     * @param {Client} client
     */
    constructor(client) {
        this._client = client;
        /** @type {UndoEntry[]} */
        this._undoEntries = [];
        /** @type {UndoEntry[]} */
        this._redoEntries = [];
    }

    /**
     * Adds a new action with the current clipboard, dropping everything that could be redone.
     * @param {Blueprint} placed in world tiles
     * @param {CacheEntry[]} deletedObjects
     * @returns {void}
     */
    add(placed, deletedObjects) {
        this._undoEntries.push(new UndoEntry(placed, buildWorldBlueprint(deletedObjects), this._client.clipboard));
        if (this._undoEntries.length > UNDO_DEPTH) {
            this._undoEntries.shift();
        }
        this._redoEntries = [];
    }

    /**
     * Reverts the newest action.
     * @returns {boolean} whether there was one
     */
    undo() {
        const entry = this._undoEntries.pop();
        if (entry === undefined) {
            return false;
        }
        this._redoEntries.push(this._apply(entry));
        return true;
    }

    /**
     * Repeats the newest undone action.
     * @returns {boolean} whether there was one
     */
    redo() {
        const entry = this._redoEntries.pop();
        if (entry === undefined) {
            return false;
        }
        this._undoEntries.push(this._apply(entry));
        return true;
    }

    /**
     * Reverses an entry and returns its inverse.
     * @private
     * @param {UndoEntry} entry
     * @returns {UndoEntry}
     */
    _apply(entry) {
        const client = this._client;
        const inverse = new UndoEntry(entry.deleted, entry.placed, client.clipboard);
        if (entry.placed.entries.length > 0) {
            client.session.sendMessage(new DeleteBlueprintMessage(entry.placed));
        }
        if (entry.deleted.entries.length > 0) {
            client.session.sendMessage(new PlaceBlueprintMessage(0, 0, entry.deleted));
        }
        if (entry.clipboard !== client.clipboard) {
            client.clipboard = entry.clipboard;
            const toolbar = client.hud.toolbarLayer;
            if (toolbar.activeTool === client.blueprintTool) {
                // Re-activating makes the paste tool take the restored clipboard.
                toolbar.setActiveTool(null);
                toolbar.setActiveTool(client.blueprintTool);
            }
        }
        return inverse;
    }
}
