import {AbstractComponent} from "@/sim/AbstractComponent.js";
import {EMPTY, NO_EID} from "@/sim/sentinels.js";

/**
 * A crafting machine: its ports, input slots, the craft in progress and its outputs.
 */
export class MachineComponent extends AbstractComponent {

    constructor() {
        super("Machine", [
            {name: "out", kind: "eid", defaultValue: NO_EID},
            // Byproduct port; NO_EID unless the object type declares a second output port.
            {name: "out2", kind: "eid", defaultValue: NO_EID},
            {name: "in0", kind: "eid", defaultValue: NO_EID},
            {name: "in1", kind: "eid", defaultValue: NO_EID},
            {name: "in2", kind: "eid", defaultValue: NO_EID},
            {name: "slot0", kind: "item", defaultValue: EMPTY},
            {name: "slot1", kind: "item", defaultValue: EMPTY},
            {name: "slot2", kind: "item", defaultValue: EMPTY},
            {name: "processing0", kind: "item", defaultValue: EMPTY},
            {name: "processing1", kind: "item", defaultValue: EMPTY},
            {name: "processing2", kind: "item", defaultValue: EMPTY},
            {name: "remaining", kind: "f32", defaultValue: EMPTY},
            // Overshot progress banked past a finished craft; the next craft starts this far along.
            {name: "carry", kind: "f32"},
            {name: "output", kind: "item", defaultValue: EMPTY},
            {name: "lastOutput", kind: "item", defaultValue: EMPTY},
            // This craft's rolled byproduct (EMPTY if the recipe has none or the roll missed).
            {name: "byproduct", kind: "item", defaultValue: EMPTY},
            {name: "lastByproduct", kind: "item", defaultValue: EMPTY},
            // The two behavior constants the submit pass reads per machine per tick. Kept on the row so
            // the pass never hops through PlacedObject to reach the behavior instance.
            {name: "inputCount"},
            {name: "processingTicks"},
            // Per-tick processing progress (1 unstaffed, MANNED_SPEED_MULTIPLIER fully staffed;
            // grants are full-crew-or-nothing); written by WorkerNetworks via setWorkers.
            {name: "workerStep", kind: "f32", defaultValue: 1},
            // Logic-network switch; a disabled machine pauses whole (no gather, craft, or output).
            {name: "enabled", defaultValue: 1},
        ], {sparse: true});
    }
}
