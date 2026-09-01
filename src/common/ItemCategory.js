import {getOrCreate} from "@/common/util.js";

/**
 * A named collection-log section with its item definitions; same-name categories merge and
 * sections sort by name.
 */
export class ItemCategory {

    /**
     * @param {string} name section title
     * @param {Object.<number, ItemDefinition>} items item type -> definition
     */
    constructor(name, items) {
        this.name = name;
        this.items = items;
    }

    /**
     * Merges contributions by name, sorted by name.
     * @param {ItemCategory[]} contributions
     * @returns {ItemCategory[]}
     */
    static merge(contributions) {
        const merged = new Map();
        for (const category of contributions) {
            if (category.name === "") {
                throw new Error("Item category with empty name");
            }
            const existing = getOrCreate(merged, category.name, () => new ItemCategory(category.name, {}));
            Object.assign(existing.items, category.items);
        }
        return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
}
