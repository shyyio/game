import {Blueprint, BlueprintEntry} from "@/common/Blueprint.js";
import {DeleteBlueprintMessage, PlaceBlueprintMessage} from "@/common/CoreMessages.js";

// Actions kept for undo; the oldest drops off past it.
export const UNDO_DEPTH = 100;

// The placed side of an action that only deleted.
export const NOTHING_PLACED = new Blueprint([]);

/**
 * One player action: the objects it placed and deleted, in world tiles, and the blueprint it pushed
 * onto or removed from the blueprint history.
 */
class UndoEntry {

    /**
     * @param {Blueprint} placed
     * @param {Blueprint} deleted
     * @param {Blueprint|null} pushedBlueprint
     * @param {Blueprint|null} removedBlueprint
     */
    constructor(placed, deleted, pushedBlueprint, removedBlueprint) {
        this.placed = placed;
        this.deleted = deleted;
        this.pushedBlueprint = pushedBlueprint;
        this.removedBlueprint = removedBlueprint;
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
 * resolves in message order after the placement, places back what it deleted, reverses its
 * blueprint history change, and hands its inverse to the other stack.
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
     * Adds a new action, dropping everything that could be redone.
     * @param {Blueprint} placed in world tiles
     * @param {CacheEntry[]} deletedObjects
     * @returns {void}
     */
    add(placed, deletedObjects) {
        this._addEntry(new UndoEntry(placed, buildWorldBlueprint(deletedObjects), null, null));
    }

    /**
     * Adds a copy or cut that pushed `copied` onto the blueprint history, dropping everything that
     * could be redone.
     * @param {Blueprint} copied
     * @param {CacheEntry[]} deletedObjects
     * @returns {void}
     */
    addCopied(copied, deletedObjects) {
        this._addEntry(new UndoEntry(NOTHING_PLACED, buildWorldBlueprint(deletedObjects), copied, null));
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
     * @private
     * @param {UndoEntry} entry
     * @returns {void}
     */
    _addEntry(entry) {
        this._undoEntries.push(entry);
        if (this._undoEntries.length > UNDO_DEPTH) {
            this._undoEntries.shift();
        }
        this._redoEntries = [];
    }

    /**
     * Reverses an entry and returns its inverse.
     * @private
     * @param {UndoEntry} entry
     * @returns {UndoEntry}
     */
    _apply(entry) {
        const client = this._client;
        const inverse = new UndoEntry(entry.deleted, entry.placed, entry.removedBlueprint, entry.pushedBlueprint);
        if (entry.placed.entries.length > 0) {
            client.session.sendMessage(new DeleteBlueprintMessage(entry.placed));
        }
        if (entry.deleted.entries.length > 0) {
            client.session.sendMessage(new PlaceBlueprintMessage(0, 0, entry.deleted));
        }
        if (entry.pushedBlueprint !== null) {
            client.blueprints.remove(entry.pushedBlueprint);
        }
        if (entry.removedBlueprint !== null) {
            client.blueprints.push(entry.removedBlueprint);
        }
        const toolbar = client.hud.toolbarLayer;
        if (toolbar.activeTool === client.blueprintTool && (entry.pushedBlueprint !== null || entry.removedBlueprint !== null)) {
            // Re-activating makes the paste tool take the history's selected blueprint.
            toolbar.setActiveTool(null);
            toolbar.setActiveTool(client.blueprintTool);
        }
        return inverse;
    }
}
