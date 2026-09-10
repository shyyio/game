import {AbstractComponent, FieldDefinition, EMPTY, NO_EID} from "@/sim/AbstractComponent.js";

/**
 * A resource extractor: its output port, the resource under it and the cycle in progress.
 */
export class ExtractorComponent extends AbstractComponent {

    constructor() {
        super("Extractor", [
            new FieldDefinition("outputPort", "eid", NO_EID),
            new FieldDefinition("resourceType", "i32", EMPTY),
            new FieldDefinition("remaining", "f32", EMPTY),
            // Overshot progress banked past a finished cycle; the next cycle starts this far along.
            new FieldDefinition("carry", "f32"),
            new FieldDefinition("output", "item", EMPTY),
            new FieldDefinition("lastOutput", "item", EMPTY),
            // The countdown length, kept on the row so the submit pass reaches no behavior instance
            // while an extractor is merely counting down.
            new FieldDefinition("processingTicks"),
        ], {sparse: true});
    }
}
