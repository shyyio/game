import {AbstractComponent, FieldDefinition, EMPTY, NO_EID} from "@spup/sdk";

/**
 * A tank: its ports, the fluid it holds and how much.
 */
export class TankComponent extends AbstractComponent {

    constructor() {
        super("Tank", [
            new FieldDefinition("inputPort", "eid", NO_EID),
            new FieldDefinition("outputPort", "eid", NO_EID),
            new FieldDefinition("fluidType", "item", EMPTY),
            new FieldDefinition("amount"),
            // Denormalized from the behavior so the tick pass stays on the row.
            new FieldDefinition("capacity"),
        ], {sparse: true});
    }
}
