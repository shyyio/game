import {getOrCreate} from "@/common/util.js";

/**
 * A named collection-log section with its item definitions; same-name categories merge.
 */
export class ItemCategory {

    /**
     * @param {string} name section title
     * @param {number} displayOrder sort key, ties in contribution order
     * @param {Object.<number, ItemDefinition>} items item type -> definition
     */
    constructor(name, displayOrder, items) {
        this.name = name;
        this.displayOrder = displayOrder;
        this.items = items;
    }

    /**
     * Merges contributions by name, sorted by displayOrder.
     * @param {ItemCategory[]} contributions
     * @returns {ItemCategory[]}
     */
    static merge(contributions) {
        const merged = new Map();
        for (const category of contributions) {
            if (category.name === "") {
                throw new Error("Item category with empty name");
            }
            const existing = getOrCreate(merged, category.name, () => new ItemCategory(category.name, category.displayOrder, {}));
            if (existing.displayOrder !== category.displayOrder) {
                throw new Error(`Item category "${category.name}" declared with displayOrder ${category.displayOrder} and ${existing.displayOrder}`);
            }
            Object.assign(existing.items, category.items);
        }
        return [...merged.values()].sort((a, b) => a.displayOrder - b.displayOrder);
    }
}
