import {
    ObjectType,
    PortDefinition,
    PlacementRule,
    Direction,
    RoadBehavior,
    HousingBehavior,
    CONVEYS_ITEM,
} from "@spup/sdk";
import {
    BELT_NORMAL,
    BELT_TUNNEL_DOWN,
    BELT_TUNNEL_UP,
    BELT_UNDERGROUND,
    beltPositionLayer,
    HOUSING_WORKER_SUPPLY,
    MAP_COLOR_HOUSING,
    MAP_COLOR_ROAD,
    MAP_COLOR_BELT,
    MAP_COLOR_BELT_TUNNEL,
    DRAW_LAYER_ROAD,
} from "./constants.js";
import {SplitterBehavior} from "../sim/SplitterBehavior.js";
import {BeltBehavior} from "../sim/BeltBehavior.js";
import {GateBehavior} from "../sim/GateBehavior.js";
import {PoleBehavior} from "../sim/PoleBehavior.js";
import {LogicTerminalBehavior} from "../sim/LogicTerminalBehavior.js";

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
            conveys: CONVEYS_ITEM,
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

    // A mouth/underground never merges from the side: only its straight-axis input (local UP)
    // stays active; outputs are unchanged.
    activePorts(portKind) {
        if (portKind === "inputPorts" && this.beltKind !== BELT_NORMAL) {
            return this.inputPorts.filter(port => port.direction === Direction.UP);
        }
        return this[portKind];
    }

    // Ports a surface neighbor can connect to: a mouth buries one end, so TUNNEL_DOWN exposes only
    // its input, TUNNEL_UP only its output, and an underground nothing (fully buried).
    surfacePorts(portKind) {
        if (this.beltKind === BELT_TUNNEL_DOWN) {
            if (portKind === "inputPorts") {
                return this.activePorts(portKind);
            }
            return [];
        }
        if (this.beltKind === BELT_TUNNEL_UP) {
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

export const BeltTunnelDownDefinition = new BeltObjectType({
    name: "BeltTunnelDown",
    beltKind: BELT_TUNNEL_DOWN,
    mapColor: MAP_COLOR_BELT_TUNNEL,
});

export const BeltTunnelUpDefinition = new BeltObjectType({
    name: "BeltTunnelUp",
    beltKind: BELT_TUNNEL_UP,
    mapColor: MAP_COLOR_BELT_TUNNEL,
});

export const BeltUndergroundDefinition = new BeltObjectType({
    name: "BeltUnderground",
    beltKind: BELT_UNDERGROUND,
    overworldVisible: false,
});

// A 1x2 router; each item flows in_X -> int_X -> out_Y, resting a tick in int_X and a visible
// tick in out_Y.
export const SplitterDefinition = new ObjectType({
    name: "Splitter",
    toolId: 4,
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
    conveys: CONVEYS_ITEM,
});

// A road cell of the worker network; workers walk it from Housing to machines.
export const RoadDefinition = new ObjectType({
    name: "Road",
    toolId: 5,
    geometry: "1x1",
    textureName: "road/0",
    mapColor: MAP_COLOR_ROAD,
    drawLayerIndex: DRAW_LAYER_ROAD,
    directional: false,
    label: "Road",
    behavior: new RoadBehavior(),
    placement: new PlacementRule({replaceSameKind: true, dragToPlace: true}),
});

/**
 * Whether an ObjectType is the gate.
 * @param {ObjectType} type
 * @returns {boolean}
 */
export function isGateType(type) {
    return type.behavior instanceof GateBehavior;
}

const toggleGate = (record, session, client) => client.cache.writer("logistics").toggleGate(record.id);

// `data.gateOpen`/`data.gateFluid` pick among four frames; the base texture is the open item
// frame (also the tool icon and ghost).
class GateObjectType extends ObjectType {

    /**
     * @param {object} config - ObjectType config plus the closed/fluid texture names
     */
    constructor(config) {
        const {closedTextureName, fluidTextureName, fluidClosedTextureName, ...base} = config;
        super(base);
        this.closedTextureName = closedTextureName;
        this.fluidTextureName = fluidTextureName;
        this.fluidClosedTextureName = fluidClosedTextureName;
    }

    textureFor(data) {
        if (data.gateFluid === true) {
            return data.gateOpen === false ? this.fluidClosedTextureName : this.fluidTextureName;
        }
        return data.gateOpen === false ? this.closedTextureName : this.textureName;
    }
}

// A click-to-toggle flow stop facing the flow direction; adopts the kind of the first transport
// coupled to it.
export const GateDefinition = new GateObjectType({
    name: "Gate",
    toolId: 28,
    inputPorts: [new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP})],
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    geometry: "1x1",
    renderConnections: true,
    textureName: "gate/open",
    closedTextureName: "gate/closed",
    fluidTextureName: "gate/pipe-open",
    fluidClosedTextureName: "gate/pipe-closed",
    label: "Gate",
    behavior: new GateBehavior(),
    tapAction: toggleGate,
    wireAnchor: {x: 0.5, y: 0.2},
});

// A logic-network pole; wires draw as catenaries above objects.
export const PoleDefinition = new ObjectType({
    name: "Pole",
    toolId: 30,
    geometry: "1x1",
    textureName: "pole/0",
    directional: false,
    label: "Pole",
    behavior: new PoleBehavior(),
    wireAnchor: {x: 0.5, y: 0.2},
});

/**
 * Whether an ObjectType is the logic terminal.
 * @param {ObjectType} type
 * @returns {boolean}
 */
export function isTerminalType(type) {
    return type.behavior instanceof LogicTerminalBehavior;
}

const openTerminalConfig = (record, session, client) => client.cache.writer("logistics").openTerminalConfig(record.id);

// The config surface of a logic network; portless, wired to a pole like any device.
export const LogicTerminalDefinition = new ObjectType({
    name: "LogicTerminal",
    toolId: 29,
    geometry: "1x1",
    textureName: "terminal/0",
    directional: false,
    label: "Logic Terminal",
    behavior: new LogicTerminalBehavior(),
    tapAction: openTerminalConfig,
    wireAnchor: {x: 0.5, y: 0.2},
});

export const HousingDefinition = new ObjectType({
    name: "Housing",
    toolId: 6,
    geometry: "2x2",
    textureName: "housing/0",
    mapColor: MAP_COLOR_HOUSING,
    directional: false,
    label: "Housing",
    behavior: new HousingBehavior({workerSupply: HOUSING_WORKER_SUPPLY}),
    placement: new PlacementRule({advanceOnPlace: false}),
});
