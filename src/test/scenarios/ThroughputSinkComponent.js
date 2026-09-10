import {AbstractComponent, FieldDefinition, EMPTY, NO_EID} from "@/sim/AbstractComponent.js";

/**
 * A benchmark sink: its input port and what it consumed.
 */
export class ThroughputSinkComponent extends AbstractComponent {

    constructor() {
        super("ThroughputSink", [
            new FieldDefinition("inputPort", "eid", NO_EID),
            new FieldDefinition("consumed"),
            new FieldDefinition("lastConsumed", "i32", EMPTY),
        ], {sparse: true});
    }
}
