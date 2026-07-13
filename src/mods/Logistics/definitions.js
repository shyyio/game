import {
    ObjectDefinition,
    PortDefinition,
    Direction,
} from "@/sdk/common.js";
import {
    BELT_NORMAL,
    BELT_RAMP_DOWN,
    BELT_RAMP_UP,
    BELT_UNDERGROUND,
} from "./constants.js";

// A belt's ports differ by belt type, so it overrides the client-facing port accessors. The sim runs
// on the bitECS engine (see BeltModule); this definition only carries the ports/geometry the engine
// and client read.
class BeltObjectDefinition extends ObjectDefinition {

    // A ramp/underground never merges from the side: it exposes only its straight axis input
    // (local direction UP), so a belt path or shared port links along the tunnel axis alone. Its
    // outputs are unchanged (the single forward port), which the buried tunnel seam still needs.
    activePorts(portKind, data) {
        if (portKind === "inputPorts" && data.type !== undefined && data.type !== BELT_NORMAL) {
            return this.inputPorts.filter(port => port.direction === Direction.UP);
        }
        return this[portKind];
    }

    // The subset of activePorts a surface neighbor can connect to. A ramp buries one end, so it
    // shows no port there: a RAMP_DOWN entrance exposes only its input, a RAMP_UP exit only its
    // output, and an underground nothing (its whole run is buried). The client relies on this
    // because, unlike the server's BeltPath head/tail roles, it can't tell a buried end apart.
    surfacePorts(portKind, data) {
        if (data.type === BELT_RAMP_DOWN) {
            return portKind === "inputPorts" ? this.activePorts(portKind, data) : [];
        }
        if (data.type === BELT_RAMP_UP) {
            return portKind === "outputPorts" ? this.outputPorts : [];
        }
        if (data.type === BELT_UNDERGROUND) {
            return [];
        }
        return this.activePorts(portKind, data);
    }
}

export const BeltDefinition = new BeltObjectDefinition({
    name: "Belt",
    inputPorts: [
        new PortDefinition("virtual_left", {x: 0, y: 0, direction: Direction.RIGHT}),
        new PortDefinition("virtual_down", {x: 0, y: 0, direction: Direction.UP}),
        new PortDefinition("virtual_right", {x: 0, y: 0, direction: Direction.LEFT}),
    ],
    outputPorts: [
        new PortDefinition("virtual_up", {x: 0, y: -1, direction: Direction.UP}, false),
    ],
    internalPorts: [],
    geometry: "1x1",
});

// A 1x2 router with two inputs and two outputs (ports shared with adjacent belts) and two internal
// buffer ports; each item flows in_X -> int_X -> out_Y, resting a tick in int_X so it crosses at belt
// speed. The routing runs on the bitECS engine (see SplitterModule).
export const SplitterDefinition = new ObjectDefinition({
    name: "Splitter",
    inputPorts: [
        new PortDefinition("in_a", {x: 0, y: 0, direction: Direction.UP}),
        new PortDefinition("in_b", {x: 1, y: 0, direction: Direction.UP}),
    ],
    outputPorts: [
        new PortDefinition("out_a", {x: 0, y: -1, direction: Direction.UP}),
        new PortDefinition("out_b", {x: 1, y: -1, direction: Direction.UP}),
    ],
    internalPorts: [
        new PortDefinition("int_a"),
        new PortDefinition("int_b"),
    ],
    geometry: "1x2",
    renderConnections: true,
    textureName: "splitter/1",
    label: "Splitter",
});
