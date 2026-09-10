import {AbstractComponent, FieldDefinition, NO_EID} from "@/sim/AbstractComponent.js";
import {Direction} from "@/common/constants.js";

/**
 * One cell of a lane: the lane it belongs to, the cell flow continues into, and the edge flow
 * reaches it over.
 */
export class LaneCellComponent extends AbstractComponent {

    constructor() {
        super("LaneCell", [
            new FieldDefinition("lane", "eid", NO_EID),
            new FieldDefinition("childCell", "eid", NO_EID),
            // In the cell's own frame: UP is its straight back edge.
            new FieldDefinition("parentEdge", "i32", Direction.UP),
        ], {isSparse: true});
    }
}
