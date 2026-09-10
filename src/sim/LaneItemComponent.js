import {AbstractComponent} from "@/sim/AbstractComponent.js";
import {EMPTY, NO_EID} from "@/sim/sentinels.js";

/**
 * The items riding the lanes: each lane holds its items in a singly linked file ordered
 * output-edge first. An item carries the number of empty slots ahead of it, so one decrement
 * advances it and everything behind it, and popping the lead leaves the next item's gap already
 * correct.
 */
export class LaneItemComponent extends AbstractComponent {

    constructor() {
        super("LaneItem", [
            {name: "lane", kind: "eid", defaultValue: NO_EID},
            {name: "nextItem", kind: "eid", defaultValue: NO_EID},
            {name: "itemTypeId", kind: "item", defaultValue: EMPTY},
            {name: "gap"},
            {name: "itemRef"},
        ], {sparse: true});
    }

    /**
     * Creates a detached item.
     * @param {number} itemTypeId
     * @returns {number} the item eid
     */
    create(itemTypeId) {
        const eid = super.create();
        this.store.itemTypeId[this.getRowByEid(eid)] = itemTypeId;
        return eid;
    }

    /**
     * Every item of a file, output-edge first.
     * @param {number} firstItemEid - the lane's lead item, NO_EID when it holds none
     * @returns {number[]} item eids
     */
    getFileByFirstItemEid(firstItemEid) {
        const itemEids = [];
        let itemEid = firstItemEid;
        while (itemEid !== NO_EID) {
            itemEids.push(itemEid);
            itemEid = this.store.nextItem[this.getRowByEid(itemEid)];
        }
        return itemEids;
    }
}
