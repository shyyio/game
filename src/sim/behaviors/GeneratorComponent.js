import {AbstractComponent} from "@/sim/AbstractComponent.js";
import {EMPTY, NO_EID} from "@/sim/sentinels.js";

/**
 * A generator: its output port and cycle, plus the secondary cycle a type with a second output port runs.
 */
export class GeneratorComponent extends AbstractComponent {

    constructor() {
        super("Generator", [
            {name: "outputPort", kind: "eid", defaultValue: NO_EID},
            {name: "remaining", kind: "f32", defaultValue: EMPTY},
            {name: "carry", kind: "f32"},
            {name: "output", kind: "item", defaultValue: EMPTY},
            {name: "lastOutput", kind: "item", defaultValue: EMPTY},
            {name: "processingTicks"},
            // Secondary cycle; unused columns stay at fill for a type with no secondary port.
            {name: "outputPort2", kind: "eid", defaultValue: NO_EID},
            {name: "remaining2", kind: "f32", defaultValue: EMPTY},
            {name: "carry2", kind: "f32"},
            {name: "output2", kind: "item", defaultValue: EMPTY},
            {name: "lastOutput2", kind: "item", defaultValue: EMPTY},
            {name: "processingTicks2"},
        ], {sparse: true});
    }
}
