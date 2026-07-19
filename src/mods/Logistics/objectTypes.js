import {
    ObjectType,
    PortDefinition,
    PlacementRule,
    Direction,
    RoadBehavior,
    HousingBehavior,
} from "@/sdk/common.js";
import {
    BELT_NORMAL,
    BELT_RAMP_DOWN,
    BELT_RAMP_UP,
    BELT_UNDERGROUND,
    HOUSING_LABOR_SUPPLY,
    MAP_COLOR_HOUSING,
    MAP_COLOR_ROAD,
    DRAW_LAYER_ROAD,
} from "./constants.js";
import {SplitterBehavior} from "./SplitterBehavior.js";

// A belt's ports differ by belt type, so it overrides the client-facing port accessors. The sim is
// bespoke (see Belts) — `behavior: null` opts it out of the derived entity host; this type only
// carries the ports/geometry the engine and client read.
class BeltObjectType extends ObjectType {

    // A ramp/underground never merges from the side: it exposes only its straight axis input
    // (local direction UP), so a belt path or shared port links along the tunnel axis alone. Its
    // outputs are unchanged (the single forward port), which the buried tunnel seam still needs.
    activePorts(portKind, data) {
        if (portKind === "inputPorts" && data.beltType !== undefined && data.beltType !== BELT_NORMAL) {
            return this.inputPorts.filter(port => port.direction === Direction.UP);
        }
        return this[portKind];
    }

    // The subset of activePorts a surface neighbor can connect to. A ramp buries one end, so it
    // shows no port there: a RAMP_DOWN entrance exposes only its input, a RAMP_UP exit only its
    // output, and an underground nothing (its whole run is buried). The client relies on this
    // because, unlike the server's BeltPath head/tail roles, it can't tell a buried end apart.
    surfacePorts(portKind, data) {
        if (data.beltType === BELT_RAMP_DOWN) {
            return portKind === "inputPorts" ? this.activePorts(portKind, data) : [];
        }
        if (data.beltType === BELT_RAMP_UP) {
            return portKind === "outputPorts" ? this.outputPorts : [];
        }
        if (data.beltType === BELT_UNDERGROUND) {
            return [];
        }
        return this.activePorts(portKind, data);
    }
}

export const BeltDefinition = new BeltObjectType({
    name: "Belt",
    inputPorts: [
        new PortDefinition("virtual_left", {x: 0, y: 0, direction: Direction.RIGHT}),
        new PortDefinition("virtual_down", {x: 0, y: 0, direction: Direction.UP}),
        new PortDefinition("virtual_right", {x: 0, y: 0, direction: Direction.LEFT}),
    ],
    outputPorts: [
        new PortDefinition("virtual_up", {x: 0, y: -1, direction: Direction.UP}, false),
    ],
    geometry: "1x1",
    behavior: null,
});

// A 1x2 router with two inputs and two outputs (ports shared with adjacent belts) and two internal
// buffer ports; each item flows in_X -> int_X -> out_Y, resting a tick in int_X so it crosses at belt
// speed. The routing runs in SplitterBehavior's seam systems.
export const SplitterDefinition = new ObjectType({
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
    behavior: new SplitterBehavior(),
});

// A road cell of the labor network; workers walk it from Housing to the machines it serves.
export const RoadDefinition = new ObjectType({
    name: "Road",
    geometry: "1x1",
    textureName: "road/0",
    mapColor: MAP_COLOR_ROAD,
    drawLayerIndex: DRAW_LAYER_ROAD,
    directional: false,
    label: "Road",
    behavior: new RoadBehavior(),
    placement: new PlacementRule({replaceSameKind: true}),
});

export const HousingDefinition = new ObjectType({
    name: "Housing",
    geometry: "2x2",
    textureName: "housing/0",
    mapColor: MAP_COLOR_HOUSING,
    directional: false,
    label: "Housing",
    behavior: new HousingBehavior({laborSupply: HOUSING_LABOR_SUPPLY}),
    placement: new PlacementRule({advanceOnPlace: false}),
});
