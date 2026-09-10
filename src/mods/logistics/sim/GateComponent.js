import {AbstractComponent, EMPTY, NO_EID} from "@spup/sdk";

// No toggle buffered.
export const PENDING_NONE = -1;

/**
 * A gate: its ports, open state, mode and the fluid buffer fluid mode carries.
 */
export class GateComponent extends AbstractComponent {

    constructor() {
        super("Gate", [
            {name: "inputPort", kind: "eid", defaultValue: NO_EID},
            {name: "outputPort", kind: "eid", defaultValue: NO_EID},
            // Item mode's internal port; NO_EID in fluid mode.
            {name: "internalPort", kind: "eid", defaultValue: NO_EID},
            {name: "open", defaultValue: 1},
            // Current mode, adopted from coupled transports (see _review).
            {name: "fluid"},
            // Fluid mode's one-unit buffer, EMPTY when empty.
            {name: "buffered", kind: "item", defaultValue: EMPTY},
            // The last fluid buffered, so a client placing a pipe knows what the gate carries.
            {name: "lastOutput", kind: "item", defaultValue: EMPTY},
            // Toggle request applied at the next tick; PENDING_NONE when idle.
            {name: "pendingOpen", defaultValue: PENDING_NONE},
        ], {sparse: true});
    }
}
