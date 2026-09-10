import {EMPTY, NO_EID} from "@/sim/sentinels.js";

/**
 * Where lane items live: the LaneItem component and the singly linked file each lane holds them in,
 * ordered output-edge first. An item carries the number of empty slots ahead of it, so one
 * decrement advances it and everything behind it, and popping the lead leaves the next item's gap
 * already correct.
 */
export class ItemArena {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        this.engine = engine;

        this.def = engine.components.define("LaneItem", [
            {name: "lane", kind: "eid", defaultValue: NO_EID},
            {name: "nextItem", kind: "eid", defaultValue: NO_EID},
            {name: "itemTypeId", kind: "item", defaultValue: EMPTY},
            {name: "gap"},
            {name: "itemRef"},
        ], {sparse: true});

        /**
         * The LaneItem columns, indexed by {@link ItemArena#row}.
         * @type {Object<string, Int32Array>}
         */
        this.store = this.def.store;
    }

    /**
     * @param {number} eid
     * @returns {number} the item's column row
     */
    row(eid) {
        return this.def.row(eid);
    }

    /**
     * Creates a detached item.
     * @param {number} itemTypeId
     * @param {number} gap
     * @param {number} itemRef
     * @returns {number} the item eid
     */
    create(itemTypeId, gap, itemRef) {
        const eid = this.def.create();
        const row = this.def.row(eid);
        this.store.lane[row] = NO_EID;
        this.store.nextItem[row] = NO_EID;
        this.store.itemTypeId[row] = itemTypeId;
        this.store.gap[row] = gap;
        this.store.itemRef[row] = itemRef;
        return eid;
    }

    /**
     * @param {number} eid
     * @returns {void}
     */
    destroy(eid) {
        this.engine.components.destroyEntity(eid);
    }

    /**
     * Every item of a lane, output-edge first.
     * @param {number} first - the lane's lead item, NO_EID when it holds none
     * @returns {number[]} item eids
     */
    file(first) {
        const items = [];
        let eid = first;
        while (eid !== NO_EID) {
            items.push(eid);
            eid = this.store.nextItem[this.def.row(eid)];
        }
        return items;
    }
}
