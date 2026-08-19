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
     * @param {number} itemType
     * @param {ItemDefinition} definition
     * @returns {void}
     */
    register(itemType, definition) {
        if (this._byType.has(itemType)) {
            throw new Error(`Duplicate item definition for item type ${itemType}`);
        }
        this._byType.set(itemType, definition);
    }

    /**
     * The definition for an item type; throws on an unregistered type.
     * @param {number} itemType
     * @returns {ItemDefinition}
     */
    require(itemType) {
        const definition = this._byType.get(itemType);
        if (definition === undefined) {
            throw new Error(`Unknown item type ${itemType}`);
        }
        return definition;
    }

    /**
     * The definition for an item type, or undefined; for wire-fed types a stale loadout may not
     * declare (render/label fallback).
     * @param {number} itemType
     * @returns {ItemDefinition|undefined}
     */
    get(itemType) {
        return this._byType.get(itemType);
    }

    /**
     * The definition for an item type, or {@link DEFAULT_ITEM_DEFINITION} for an unmapped one.
     * @param {number} itemType
     * @returns {ItemDefinition}
     */
    definitionFor(itemType) {
        const definition = this._byType.get(itemType);
        if (definition === undefined) {
            return DEFAULT_ITEM_DEFINITION;
        }
        return definition;
    }
}
