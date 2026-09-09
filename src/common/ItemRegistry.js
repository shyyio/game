import {ItemDefinition} from "@/common/ItemDefinition.js";

// Stands in for an item type no loaded mod declares.
export const DEFAULT_ITEM_DEFINITION = new ItemDefinition("Unknown", "items/3");

/**
 * The declarative register of item definitions, keyed by item type; built once at
 * ModRegistry.freeze() from every mod's declaration.items.
 */
export class ItemRegistry {

    constructor() {
        /**
         * @type {Map<number, ItemDefinition>}
         */
        this._byType = new Map();
    }

    /**
     * @param {number} itemTypeId
     * @param {ItemDefinition} definition
     * @returns {void}
     */
    register(itemTypeId, definition) {
        if (this._byType.has(itemTypeId)) {
            throw new Error(`Duplicate item definition for item type ${itemTypeId}`);
        }
        this._byType.set(itemTypeId, definition);
    }

    /**
     * The definition for an item type; throws on an unregistered type.
     * @param {number} itemTypeId
     * @returns {ItemDefinition}
     */
    require(itemTypeId) {
        const definition = this._byType.get(itemTypeId);
        if (definition === undefined) {
            throw new Error(`Unknown item type ${itemTypeId}`);
        }
        return definition;
    }

    /**
     * The definition for an item type, or undefined; for wire-fed types a stale loadout may not
     * declare (render/label fallback).
     * @param {number} itemTypeId
     * @returns {ItemDefinition|undefined}
     */
    get(itemTypeId) {
        return this._byType.get(itemTypeId);
    }

    /**
     * Every registered (itemTypeId, definition) pair.
     * @returns {IterableIterator<[number, ItemDefinition]>}
     */
    entries() {
        return this._byType.entries();
    }

    /**
     * The definition for an item type, or {@link DEFAULT_ITEM_DEFINITION} for an unmapped one.
     * @param {number} itemTypeId
     * @returns {ItemDefinition}
     */
    definitionFor(itemTypeId) {
        const definition = this._byType.get(itemTypeId);
        if (definition === undefined) {
            return DEFAULT_ITEM_DEFINITION;
        }
        return definition;
    }
}
