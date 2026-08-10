import {getOrCreate} from "@/common/util.js";

/**
 * A named settings-menu section; same-name categories merge.
 */
export class SettingCategory {

    /**
     * @param {string} name section title
     * @param {number} displayOrder sort key, ties in contribution order
     * @param {AbstractSettingControl[]} controls
     */
    constructor(name, displayOrder, controls) {
        this.name = name;
        this.displayOrder = displayOrder;
        this.controls = controls;
    }

    /**
     * Merges contributions by name, sorted by displayOrder.
     * @param {SettingCategory[]} contributions
     * @returns {SettingCategory[]}
     */
    static merge(contributions) {
        const merged = new Map();
        for (const category of contributions) {
            if (category.name === "") {
                throw new Error("Settings category with empty name");
            }
            const existing = getOrCreate(merged, category.name, () => new SettingCategory(category.name, category.displayOrder, []));
            if (existing.displayOrder !== category.displayOrder) {
                throw new Error(`Settings category "${category.name}" declared with displayOrder ${category.displayOrder} and ${existing.displayOrder}`);
            }
            existing.controls.push(...category.controls);
        }
        return [...merged.values()].sort((a, b) => a.displayOrder - b.displayOrder);
    }
}
