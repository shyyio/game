import {AbstractComponent, NO_EID} from "@spup/sdk";

/**
 * A splitter: its two input, two internal and two output ports, and the round-robin state.
 */
export class SplitterComponent extends AbstractComponent {

    constructor() {
        super("Splitter", [
            {name: "inputPortA", kind: "eid", defaultValue: NO_EID},
            {name: "inputPortB", kind: "eid", defaultValue: NO_EID},
            {name: "outputPortA", kind: "eid", defaultValue: NO_EID},
            {name: "outputPortB", kind: "eid", defaultValue: NO_EID},
            {name: "internalPortA", kind: "eid", defaultValue: NO_EID},
            {name: "internalPortB", kind: "eid", defaultValue: NO_EID},
            {name: "state"},
        ], {sparse: true});
    }
}
