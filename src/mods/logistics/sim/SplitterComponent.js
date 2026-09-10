import {AbstractComponent, FieldDefinition, NO_EID} from "@spup/sdk";

/**
 * A splitter: its two input, two internal and two output ports, and the round-robin state.
 */
export class SplitterComponent extends AbstractComponent {

    constructor() {
        super("Splitter", [
            new FieldDefinition("inputPortA", "eid", NO_EID),
            new FieldDefinition("inputPortB", "eid", NO_EID),
            new FieldDefinition("outputPortA", "eid", NO_EID),
            new FieldDefinition("outputPortB", "eid", NO_EID),
            new FieldDefinition("internalPortA", "eid", NO_EID),
            new FieldDefinition("internalPortB", "eid", NO_EID),
            new FieldDefinition("state"),
        ], {isSparse: true});
    }
}
