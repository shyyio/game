import {Blueprint} from "@/common/Blueprint.js";

// Blueprints kept; the oldest drops off past it.
export const BLUEPRINT_HISTORY_DEPTH = 20;
// localStorage key holding the history's serialized blueprints, newest first.
export const BLUEPRINT_HISTORY_STORAGE_KEY = "spup.blueprint-history";
// The selected index while no entry can be built.
const NO_SELECTION = -1;

/**
 * One stored blueprint and, when this loadout declares every type it names, the blueprint itself.
 */
class BlueprintHistoryEntry {

    /**
     * @param {SerializedBlueprint} data
     * @param {Blueprint|null} blueprint
     */
    constructor(data, blueprint) {
        this.data = data;
        this.blueprint = blueprint;
    }
}

/**
 * The copied blueprints, newest first, persisted per browser. Entries naming a type this loadout
 * lacks are kept in storage but skipped by the selection.
 */
export class BlueprintHistoryCache {

    /**
     * @param {ModRegistry} modRegistry
     * @param {Storage} storage
     */
    constructor(modRegistry, storage) {
        this._modRegistry = modRegistry;
        this._storage = storage;
        /** @type {BlueprintHistoryEntry[]} */
        this._entries = [];
        this._read();
        this._selectedIndex = this._getBuildableIndexFrom(0, 1);
    }

    /**
     * @returns {Blueprint|null}
     */
    get selected() {
        if (this._selectedIndex === NO_SELECTION) {
            return null;
        }
        return this._entries[this._selectedIndex].blueprint;
    }

    /**
     * The selected blueprint's 1-based place among the buildable ones, newest first; 0 with none.
     * @returns {number}
     */
    get selectedPosition() {
        let position = 0;
        for (let index = 0; index <= this._selectedIndex; index += 1) {
            if (this._entries[index].blueprint !== null) {
                position += 1;
            }
        }
        return position;
    }

    /**
     * How many blueprints this loadout can build.
     * @returns {number}
     */
    get count() {
        return this._entries.filter(entry => entry.blueprint !== null).length;
    }

    /**
     * Adds a blueprint as the newest and selects it.
     * @param {Blueprint} blueprint
     * @returns {void}
     */
    push(blueprint) {
        this._read();
        this._entries.unshift(new BlueprintHistoryEntry(blueprint.serialize(this._modRegistry), blueprint));
        if (this._entries.length > BLUEPRINT_HISTORY_DEPTH) {
            this._entries.pop();
        }
        this._selectedIndex = 0;
        this._write();
    }

    /**
     * Removes a blueprint, if the history still holds it; the selection stays on the one it was on,
     * or moves to the newest when that one was removed.
     * @param {Blueprint} blueprint
     * @returns {void}
     */
    remove(blueprint) {
        let selectedEntry = null;
        if (this._selectedIndex !== NO_SELECTION) {
            selectedEntry = this._entries[this._selectedIndex];
        }
        this._read();
        const index = this._entries.findIndex(entry => entry.blueprint === blueprint);
        if (index !== -1) {
            this._entries.splice(index, 1);
            this._write();
        }
        this._selectedIndex = this._entries.indexOf(selectedEntry);
        if (this._selectedIndex === NO_SELECTION) {
            this._selectedIndex = this._getBuildableIndexFrom(0, 1);
        }
    }

    /**
     * @returns {boolean} whether there was an older one
     */
    selectOlder() {
        return this._selectFrom(this._selectedIndex + 1, 1);
    }

    /**
     * @returns {boolean} whether there was a newer one
     */
    selectNewer() {
        return this._selectFrom(this._selectedIndex - 1, -1);
    }

    /**
     * Selects the first buildable entry from `start` on in `step` direction, if there is one.
     * @private
     * @param {number} start
     * @param {number} step
     * @returns {boolean}
     */
    _selectFrom(start, step) {
        if (this._selectedIndex === NO_SELECTION) {
            return false;
        }
        const index = this._getBuildableIndexFrom(start, step);
        if (index === NO_SELECTION) {
            return false;
        }
        this._selectedIndex = index;
        return true;
    }

    /**
     * @private
     * @param {number} start
     * @param {number} step
     * @returns {number} NO_SELECTION when none is left that way
     */
    _getBuildableIndexFrom(start, step) {
        for (let index = start; index >= 0 && index < this._entries.length; index += step) {
            if (this._entries[index].blueprint !== null) {
                return index;
            }
        }
        return NO_SELECTION;
    }

    /**
     * Rebuilds the entries from storage, which another tab may have written; an entry still stored
     * keeps its blueprint instance.
     * @private
     * @returns {void}
     */
    _read() {
        const previousEntries = this._entries;
        this._entries = [];
        const stored = this._storage.getItem(BLUEPRINT_HISTORY_STORAGE_KEY);
        if (stored === null) {
            return;
        }
        for (const data of JSON.parse(stored)) {
            const text = JSON.stringify(data);
            const previousIndex = previousEntries.findIndex(entry => JSON.stringify(entry.data) === text);
            if (previousIndex !== -1) {
                this._entries.push(previousEntries.splice(previousIndex, 1)[0]);
            } else if (Blueprint.canDeserialize(data, this._modRegistry)) {
                this._entries.push(new BlueprintHistoryEntry(data, Blueprint.deserialize(data, this._modRegistry)));
            } else {
                this._entries.push(new BlueprintHistoryEntry(data, null));
            }
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _write() {
        this._storage.setItem(BLUEPRINT_HISTORY_STORAGE_KEY, JSON.stringify(this._entries.map(entry => entry.data)));
    }
}
