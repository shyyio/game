import {AbstractComponent, NO_EID} from "@spup/sdk";

/**
 * A splitter: its two input, two internal and two output ports, and the round-robin state.
 */
export class SplitterComponent extends AbstractComponent {

    constructor() {
        super("Splitter", [
            {name: "in_a", kind: "eid", defaultValue: NO_EID},
            {name: "in_b", kind: "eid", defaultValue: NO_EID},
            {name: "out_a", kind: "eid", defaultValue: NO_EID},
            {name: "out_b", kind: "eid", defaultValue: NO_EID},
            {name: "int_a", kind: "eid", defaultValue: NO_EID},
            {name: "int_b", kind: "eid", defaultValue: NO_EID},
            {name: "state"},
        ], {sparse: true});
    }
}
