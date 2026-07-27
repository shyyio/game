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
    beltPositionLayer,
    HOUSING_WORKER_SUPPLY,
    MAP_COLOR_HOUSING,
    MAP_COLOR_ROAD,
    MAP_COLOR_BELT,
    MAP_COLOR_BELT_RAMP,
    DRAW_LAYER_ROAD,
} from "./constants.js";
import {SplitterBehavior} from "../sim/SplitterBehavior.js";
import {BeltBehavior} from "../sim/BeltBehavior.js";

// One ObjectType per belt kind (the typeId carries the kind on the wire); `bespokeClient` opts
// out of the derived bundles since BeltDrawLayer/BeltTool stay bespoke.
class BeltObjectType extends ObjectType {

    /**
     * @param {object} config - ObjectType config plus `beltKind`
     */
    constructor(config) {
        const {beltKind, ...base} = config;
        super({
            ...base,
            geometry: "1x1",
            behavior: new BeltBehavior({beltKind}),
            bespokeClient: true,
            placement: new PlacementRule({conveyor: beltKind === BELT_NORMAL}),
            inputPorts: [
                new PortDefinition("virtual_left", {x: 0, y: 0, direction: Direction.RIGHT}),
                new PortDefinition("virtual_down", {x: 0, y: 0, direction: Direction.UP}),
                new PortDefinition("virtual_right", {x: 0, y: 0, direction: Direction.LEFT}),
            ],
            outputPorts: [
                new PortDefinition("virtual_up", {x: 0, y: -1, direction: Direction.UP}, false),
            ],
        });
        this.beltKind = beltKind;
    }

    // An underground occupies its axis layer, so it can cross under a surface belt.
    positionLayerTiles(direction) {
        return [{layer: beltPositionLayer(this.beltKind, direction), cells: this.geometry.tiles(direction)}];
    }

    // A ramp/underground never merges from the side: only its straight-axis input (local UP)
    // stays active; outputs are unchanged.
    activePorts(portKind) {
        if (portKind === "inputPorts" && this.beltKind !== BELT_NORMAL) {
            return this.inputPorts.filter(port => port.direction === Direction.UP);
        }
        return this[portKind];
    }

    // Ports a surface neighbor can connect to: a ramp buries one end, so RAMP_DOWN exposes only
    // its input, RAMP_UP only its output, and an underground nothing (fully buried).
    surfacePorts(portKind) {
        if (this.beltKind === BELT_RAMP_DOWN) {
            if (portKind === "inputPorts") {
                return this.activePorts(portKind);
            }
            return [];
        }
        if (this.beltKind === BELT_RAMP_UP) {
            if (portKind === "outputPorts") {
                return this.outputPorts;
            }
            return [];
        }
        if (this.beltKind === BELT_UNDERGROUND) {
            return [];
        }
        return this.activePorts(portKind);
    }
}

/**
 * Whether an ObjectType is one of the belt kinds.
 * @param {ObjectType} type
 * @returns {boolean}
 */
export function isBeltType(type) {
    return type instanceof BeltObjectType;
}

export const BeltDefinition = new BeltObjectType({
    name: "Belt",
    beltKind: BELT_NORMAL,
    mapColor: MAP_COLOR_BELT,
});

export const BeltRampDownDefinition = new BeltObjectType({
    name: "BeltRampDown",
    beltKind: BELT_RAMP_DOWN,
    mapColor: MAP_COLOR_BELT_RAMP,
});

export const BeltRampUpDefinition = new BeltObjectType({
    name: "BeltRampUp",
    beltKind: BELT_RAMP_UP,
    mapColor: MAP_COLOR_BELT_RAMP,
});

export const BeltUndergroundDefinition = new BeltObjectType({
    name: "BeltUnderground",
    beltKind: BELT_UNDERGROUND,
    overworldVisible: false,
});

// A 1x2 router; each item flows in_X -> int_X -> out_Y, resting a tick in int_X so it crosses at
// belt speed.
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

// A road cell of the worker network; workers walk it from Housing to machines.
export const RoadDefinition = new ObjectType({
    name: "Road",
    geometry: "1x1",
    textureName: "road/0",
    mapColor: MAP_COLOR_ROAD,
    drawLayerIndex: DRAW_LAYER_ROAD,
    directional: false,
    label: "Road",
    behavior: new RoadBehavior(),
    placement: new PlacementRule({replaceSameKind: true, dragToPlace: true}),
});

export const HousingDefinition = new ObjectType({
    name: "Housing",
    geometry: "2x2",
    textureName: "housing/0",
    mapColor: MAP_COLOR_HOUSING,
    directional: false,
    label: "Housing",
    behavior: new HousingBehavior({workerSupply: HOUSING_WORKER_SUPPLY}),
    placement: new PlacementRule({advanceOnPlace: false}),
});
