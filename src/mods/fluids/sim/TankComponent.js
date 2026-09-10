import {AbstractComponent, EMPTY, NO_EID} from "@spup/sdk";

/**
 * A tank: its ports, the fluid it holds and how much.
 */
export class TankComponent extends AbstractComponent {

    constructor() {
        super("Tank", [
            {name: "in", kind: "eid", defaultValue: NO_EID},
            {name: "out", kind: "eid", defaultValue: NO_EID},
            {name: "fluidType", kind: "item", defaultValue: EMPTY},
            {name: "amount"},
            // Denormalized from the behavior so the tick pass stays on the row.
            {name: "capacity"},
        ], {sparse: true});
    }
}
