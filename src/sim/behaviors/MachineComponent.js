import {AbstractComponent, FieldDefinition, EMPTY, NO_EID} from "@/sim/AbstractComponent.js";

/**
 * A crafting machine: its ports, input slots, the craft in progress and its outputs.
 */
export class MachineComponent extends AbstractComponent {

    constructor() {
        super("Machine", [
            new FieldDefinition("outputPort", "eid", NO_EID),
            // Byproduct port; NO_EID unless the object type declares a second output port.
            new FieldDefinition("outputPort2", "eid", NO_EID),
            new FieldDefinition("inputPort0", "eid", NO_EID),
            new FieldDefinition("inputPort1", "eid", NO_EID),
            new FieldDefinition("inputPort2", "eid", NO_EID),
            new FieldDefinition("slot0", "item", EMPTY),
            new FieldDefinition("slot1", "item", EMPTY),
            new FieldDefinition("slot2", "item", EMPTY),
            new FieldDefinition("processing0", "item", EMPTY),
            new FieldDefinition("processing1", "item", EMPTY),
            new FieldDefinition("processing2", "item", EMPTY),
            new FieldDefinition("remaining", "f32", EMPTY),
            // Overshot progress banked past a finished craft; the next craft starts this far along.
            new FieldDefinition("carry", "f32"),
            new FieldDefinition("output", "item", EMPTY),
            new FieldDefinition("lastOutput", "item", EMPTY),
            // This craft's rolled byproduct (EMPTY if the recipe has none or the roll missed).
            new FieldDefinition("byproduct", "item", EMPTY),
            new FieldDefinition("lastByproduct", "item", EMPTY),
            // The two behavior constants the submit pass reads per machine per tick. Kept on the row so
            // the pass never hops through PlacedObject to reach the behavior instance.
            new FieldDefinition("inputCount"),
            new FieldDefinition("processingTicks"),
            // Per-tick processing progress (1 unstaffed, MANNED_SPEED_MULTIPLIER fully staffed;
            // grants are full-crew-or-nothing); written by WorkerNetworks via setWorkers.
            new FieldDefinition("workerStep", "f32", 1),
            // Logic-network switch; a disabled machine pauses whole (no gather, craft, or output).
            new FieldDefinition("enabled", "i32", 1),
        ], {sparse: true});
    }
}
