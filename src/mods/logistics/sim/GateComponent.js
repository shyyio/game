import {AbstractComponent, FieldDefinition, EMPTY, NO_EID} from "@spup/sdk";

// No toggle buffered.
export const PENDING_NONE = -1;

/**
 * A gate: its ports, open state, mode and the fluid buffer fluid mode carries.
 */
export class GateComponent extends AbstractComponent {

    constructor() {
        super("Gate", [
            new FieldDefinition("inputPort", "eid", NO_EID),
            new FieldDefinition("outputPort", "eid", NO_EID),
            // Item mode's internal port; NO_EID in fluid mode.
            new FieldDefinition("internalPort", "eid", NO_EID),
            new FieldDefinition("open", "i32", 1),
            // Current mode, adopted from coupled transports (see _review).
            new FieldDefinition("fluid"),
            // Fluid mode's one-unit buffer, EMPTY when empty.
            new FieldDefinition("buffered", "item", EMPTY),
            // The last fluid buffered, so a client placing a pipe knows what the gate carries.
            new FieldDefinition("lastOutput", "item", EMPTY),
            // Toggle request applied at the next tick; PENDING_NONE when idle.
            new FieldDefinition("pendingOpen", "i32", PENDING_NONE),
        ], {isSparse: true});
    }
}
