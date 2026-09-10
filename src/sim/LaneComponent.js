import {AbstractComponent} from "@/sim/AbstractComponent.js";
import {NO_EID} from "@/sim/sentinels.js";

/**
 * A transport lane: the chain of cells from its head, the ports at its two ends, and the file of
 * items riding it.
 */
export class LaneComponent extends AbstractComponent {

    constructor() {
        super("Lane", [
            {name: "headCell", kind: "eid", defaultValue: NO_EID},
            {name: "inputPort", kind: "eid", defaultValue: NO_EID},
            {name: "outputPort", kind: "eid", defaultValue: NO_EID},
            {name: "slotCount"},
            {name: "itemCount"},
            {name: "headGap"},
            {name: "firstItem", kind: "eid", defaultValue: NO_EID},
            {name: "lastItem", kind: "eid", defaultValue: NO_EID},
            {name: "nextItemRef", defaultValue: 1},
        ], {sparse: true});
    }
}
