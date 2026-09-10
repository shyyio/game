import {AbstractComponent} from "@/sim/AbstractComponent.js";
import {EMPTY, NO_EID} from "@/sim/sentinels.js";

/**
 * A benchmark sink: its input port and what it consumed.
 */
export class ThroughputSinkComponent extends AbstractComponent {

    constructor() {
        super("ThroughputSink", [
            {name: "in", kind: "eid", defaultValue: NO_EID},
            {name: "consumed"},
            {name: "lastConsumed", defaultValue: EMPTY},
        ], {sparse: true});
    }
}
