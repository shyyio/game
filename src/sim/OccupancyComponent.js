import {AbstractComponent} from "@/sim/AbstractComponent.js";
import {NO_EID} from "@/sim/sentinels.js";

/**
 * The cell claim on a Position: its layer, the owner object (so a delete releases every cell by
 * query) and per-cell userData (0 for plain footprints; resource cover stores its resource type).
 * Always paired with Position; cells are the entities carrying both.
 */
export class OccupancyComponent extends AbstractComponent {

    constructor() {
        super("Occupancy", [
            {name: "layer"},
            {name: "owner", defaultValue: NO_EID},
            {name: "userData"},
        ]);
    }
}
