import {ItemType} from "@/common/ItemType.js";

// Stands in for an item type no loaded mod declares.
export const DEFAULT_ITEM_TYPE = new ItemType("Unknown", "items/3");

/**
 * The declarative register of item types, keyed by item type id; built once at
 * ModRegistry.freeze() from every mod's declaration.items.
 */
export class ItemRegistry {

    constructor() {
        /**
         * @type {Map<number, ItemType>}
         */
        this._byType = new Map();
    }

    /**
     * @param {number} itemTypeId
     * @param {ItemType} itemType
     * @returns {void}
     */
    register(itemTypeId, itemType) {
        if (this._byType.has(itemTypeId)) {
            throw new Error(`Duplicate item type ${itemTypeId}`);
        }
        this._byType.set(itemTypeId, itemType);
    }

    /**
     * The ItemType for an item type id; throws on an unregistered id.
     * @param {number} itemTypeId
     * @returns {ItemType}
     */
    getItemTypeByTypeId(itemTypeId) {
        const itemType = this._byType.get(itemTypeId);
        if (itemType === undefined) {
            throw new Error(`Unknown item type ${itemTypeId}`);
        }
        return itemType;
    }

    /**
     * The ItemType for an item type id, or undefined; for wire-fed ids a stale loadout may not
     * declare (render/label fallback).
     * @param {number} itemTypeId
     * @returns {ItemType|null}
     */
    getItemTypeByTypeIdOrNull(itemTypeId) {
        const found = this._byType.get(itemTypeId);
        if (found === undefined) {
            return null;
        }
        return found;
    }

    /**
     * Every registered (itemTypeId, ItemType) pair.
     * @returns {IterableIterator<[number, ItemType]>}
     */
    getEntries() {
        return this._byType.entries();
    }

    /**
     * The ItemType for an item type id, or {@link DEFAULT_ITEM_TYPE} for an unmapped one.
     * @param {number} itemTypeId
     * @returns {ItemType}
     */
    getItemTypeOrDefaultByTypeId(itemTypeId) {
        const itemType = this._byType.get(itemTypeId);
        if (itemType === undefined) {
            return DEFAULT_ITEM_TYPE;
        }
        return itemType;
    }
}
