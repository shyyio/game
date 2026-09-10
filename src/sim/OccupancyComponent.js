import {AbstractComponent, FieldDefinition, NO_EID} from "@/sim/AbstractComponent.js";

/**
 * The cell claim on a Position: its layer, the owner object (so a delete releases every cell by
 * query) and per-cell userData (0 for plain footprints; resource cover stores its resource type).
 * Always paired with Position; cells are the entities carrying both.
 */
export class OccupancyComponent extends AbstractComponent {

    constructor() {
        super("Occupancy", [
            new FieldDefinition("layer"),
            new FieldDefinition("owner", "i32", NO_EID),
            new FieldDefinition("userData"),
        ]);
    }
}
