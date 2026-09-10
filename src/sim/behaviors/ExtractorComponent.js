import {AbstractComponent} from "@/sim/AbstractComponent.js";
import {EMPTY, NO_EID} from "@/sim/sentinels.js";

/**
 * A resource extractor: its output port, the resource under it and the cycle in progress.
 */
export class ExtractorComponent extends AbstractComponent {

    constructor() {
        super("Extractor", [
            {name: "out", kind: "eid", defaultValue: NO_EID},
            {name: "resourceType", defaultValue: EMPTY},
            {name: "remaining", kind: "f32", defaultValue: EMPTY},
            // Overshot progress banked past a finished cycle; the next cycle starts this far along.
            {name: "carry", kind: "f32"},
            {name: "output", kind: "item", defaultValue: EMPTY},
            {name: "lastOutput", kind: "item", defaultValue: EMPTY},
            // The countdown length, kept on the row so the submit pass reaches no behavior instance
            // while an extractor is merely counting down.
            {name: "processingTicks"},
        ], {sparse: true});
    }
}
