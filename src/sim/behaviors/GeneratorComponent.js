import {AbstractComponent, FieldDefinition, EMPTY, NO_EID} from "@/sim/AbstractComponent.js";

/**
 * A generator: its output port and cycle, plus the secondary cycle a type with a second output port runs.
 */
export class GeneratorComponent extends AbstractComponent {

    constructor() {
        super("Generator", [
            new FieldDefinition("outputPort", "eid", NO_EID),
            new FieldDefinition("remaining", "f32", EMPTY),
            new FieldDefinition("carry", "f32"),
            new FieldDefinition("output", "item", EMPTY),
            new FieldDefinition("lastOutput", "item", EMPTY),
            new FieldDefinition("processingTicks"),
            // Secondary cycle; unused columns stay at fill for a type with no secondary port.
            new FieldDefinition("outputPort2", "eid", NO_EID),
            new FieldDefinition("remaining2", "f32", EMPTY),
            new FieldDefinition("carry2", "f32"),
            new FieldDefinition("output2", "item", EMPTY),
            new FieldDefinition("lastOutput2", "item", EMPTY),
            new FieldDefinition("processingTicks2"),
        ], {isSparse: true});
    }
}
