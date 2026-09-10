import {AbstractComponent, FieldDefinition, NO_EID} from "@/sim/AbstractComponent.js";

/**
 * Where an entity sits: a placed object's anchor tile, an edge port's edge, an occupied cell.
 * `direction` is NO_EID for things with no facing (cells).
 */
export class PositionComponent extends AbstractComponent {

    constructor() {
        super("Position", [
            new FieldDefinition("x"),
            new FieldDefinition("y"),
            new FieldDefinition("direction", "i32", NO_EID),
        ]);
    }
}
