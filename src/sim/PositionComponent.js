import {AbstractComponent} from "@/sim/AbstractComponent.js";
import {NO_EID} from "@/sim/sentinels.js";

/**
 * Where an entity sits: a placed object's anchor tile, an edge port's edge, an occupied cell.
 * `direction` is NO_EID for things with no facing (cells).
 */
export class PositionComponent extends AbstractComponent {

    constructor() {
        super("Position", [
            {name: "x"},
            {name: "y"},
            {name: "direction", defaultValue: NO_EID},
        ]);
    }
}
