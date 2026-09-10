import {AbstractComponent} from "@/sim/AbstractComponent.js";
import {Direction} from "@/common/constants.js";
import {NO_EID} from "@/sim/sentinels.js";

/**
 * One cell of a lane: the lane it belongs to, the cell flow continues into, and the edge flow
 * reaches it over.
 */
export class LaneCellComponent extends AbstractComponent {

    constructor() {
        super("LaneCell", [
            {name: "lane", kind: "eid", defaultValue: NO_EID},
            {name: "childCell", kind: "eid", defaultValue: NO_EID},
            // In the cell's own frame: UP is its straight back edge.
            {name: "parentEdge", defaultValue: Direction.UP},
        ], {sparse: true});
    }
}
