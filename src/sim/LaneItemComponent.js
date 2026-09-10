import {AbstractComponent, FieldDefinition, EMPTY, NO_EID} from "@/sim/AbstractComponent.js";

/**
 * The items riding the lanes: each lane holds its items in a singly linked file ordered
 * output-edge first. An item carries the number of empty slots ahead of it, so one decrement
 * advances it and everything behind it, and popping the lead leaves the next item's gap already
 * correct.
 */
export class LaneItemComponent extends AbstractComponent {

    constructor() {
        super("LaneItem", [
            new FieldDefinition("lane", "eid", NO_EID),
            new FieldDefinition("nextItem", "eid", NO_EID),
            new FieldDefinition("itemTypeId", "item", EMPTY),
            new FieldDefinition("gap"),
            new FieldDefinition("itemRef"),
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
