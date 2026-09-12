import {
    ObjectType,
    PortDefinition,
    PlacementRule,
    Direction,
    RoadBehavior,
    HousingBehavior,
    CONVEYS_ITEM,
    LANE_LEVEL_SURFACE,
} from "@spup/sdk";
import {
    BELT_NORMAL,
    BELT_TUNNEL_DOWN,
    BELT_TUNNEL_UP,
    BELT_UNDERGROUND,
    BELT_RAMP_UP_1,
    BELT_ELEVATED_1,
    BELT_RAMP_DOWN_1,
    getBeltKindEntryByKind,
    HOUSING_WORKER_SUPPLY,
    MAP_COLOR_HOUSING,
    MAP_COLOR_ROAD,
    MAP_COLOR_BELT,
    MAP_COLOR_BELT_TUNNEL,
    MAP_COLOR_BELT_RAMP,
    MAP_COLOR_BELT_ELEVATED_1,
    DRAW_LAYER_ROAD,
} from "./constants.js";
import {SplitterBehavior} from "../sim/SplitterBehavior.js";
import {BeltBehavior} from "../sim/BeltBehavior.js";
import {GateBehavior} from "../sim/GateBehavior.js";
import {PoleBehavior} from "../sim/PoleBehavior.js";
import {LogicTerminalBehavior} from "../sim/LogicTerminalBehavior.js";

// One ObjectType per belt kind (the objectTypeId carries the kind on the wire); `bespokeClient` opts
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
            placement: new PlacementRule({isConveyor: beltKind === BELT_NORMAL}),
            inputPorts: [
                new PortDefinition("virtualLeft", {x: 0, y: 0, direction: Direction.RIGHT}),
                new PortDefinition("virtualDown", {x: 0, y: 0, direction: Direction.UP}),
                new PortDefinition("virtualRight", {x: 0, y: 0, direction: Direction.LEFT}),
            ],
            outputPorts: [
                new PortDefinition("virtualUp", {x: 0, y: -1, direction: Direction.UP}, false),
            ],
        });
        this.beltKind = beltKind;
    }

    // A non-merging kind takes only its straight-axis input (local UP); outputs are unchanged.
    getActivePortsByKind(portKind) {
        if (portKind === "inputPorts" && !getBeltKindEntryByKind(this.beltKind).isMerging) {
            return this.inputPorts.filter(port => port.direction === Direction.UP);
        }
        return this[portKind];
    }

    // Ports a surface neighbor can connect to: only the end this kind keeps on the surface.
    getSurfacePortsByKind(portKind) {
        const entry = getBeltKindEntryByKind(this.beltKind);
        if (portKind === "inputPorts") {
            if (entry.inLevel === LANE_LEVEL_SURFACE) {
                return this.getActivePortsByKind(portKind);
            }
            return [];
        }
        if (entry.outLevel === LANE_LEVEL_SURFACE) {
            return this.outputPorts;
        }
        return [];
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

/**
 * The position layer a belt occupies: its level's when it stands off the surface at both ends, the
 * surface otherwise, ramps included.
 * @param {ObjectType} type
 * @param {Direction} direction
 * @returns {string}
 */
export function getLayerByBeltType(type, direction) {
    return type.behavior.getPositionLayersByDirection(direction)[0];
}

/**
 * @param {BeltType} kind
 * @returns {ObjectType} the belt type of that kind
 */
export function getBeltTypeByKind(kind) {
    // Declared in kind order, so the ordinal indexes the table.
    const type = BELT_TYPES[kind];
    if (type === undefined) {
        throw new Error(`No belt type of kind ${kind}`);
    }
    return type;
}

export const BeltType = new BeltObjectType({
    name: "Belt",
    beltKind: BELT_NORMAL,
    label: "Belt",
    mapColor: MAP_COLOR_BELT,
});

export const BeltTunnelDownType = new BeltObjectType({
    name: "BeltTunnelDown",
    beltKind: BELT_TUNNEL_DOWN,
    label: "Tunnel entrance",
    mapColor: MAP_COLOR_BELT_TUNNEL,
});

export const BeltTunnelUpType = new BeltObjectType({
    name: "BeltTunnelUp",
    beltKind: BELT_TUNNEL_UP,
    label: "Tunnel exit",
    mapColor: MAP_COLOR_BELT_TUNNEL,
});

export const BeltUndergroundType = new BeltObjectType({
    name: "BeltUnderground",
    beltKind: BELT_UNDERGROUND,
    label: "Underground belt",
    overworldVisible: false,
});

export const BeltRampUp1Type = new BeltObjectType({
    name: "BeltRampUp1",
    beltKind: BELT_RAMP_UP_1,
    label: "Ramp to level 1",
    mapColor: MAP_COLOR_BELT_RAMP,
});

export const BeltElevated1Type = new BeltObjectType({
    name: "BeltElevated1",
    beltKind: BELT_ELEVATED_1,
    label: "Level 1 belt",
    mapColor: MAP_COLOR_BELT_ELEVATED_1,
});

export const BeltRampDown1Type = new BeltObjectType({
    name: "BeltRampDown1",
    beltKind: BELT_RAMP_DOWN_1,
    label: "Ramp to ground",
    mapColor: MAP_COLOR_BELT_RAMP,
});

const BELT_TYPES = [
    BeltType,
    BeltTunnelDownType,
    BeltTunnelUpType,
    BeltUndergroundType,
    BeltRampUp1Type,
    BeltElevated1Type,
    BeltRampDown1Type,
];

// A 1x2 router; each item flows in_X -> int_X -> out_Y, resting a tick in int_X and a visible
// tick in out_Y.
export const SplitterType = new ObjectType({
    name: "Splitter",
    toolId: 4,
    inputPorts: [
        new PortDefinition("inputPortA", {x: 0, y: 0, direction: Direction.UP}),
        new PortDefinition("inputPortB", {x: 1, y: 0, direction: Direction.UP}),
    ],
    outputPorts: [
        new PortDefinition("outputPortA", {x: 0, y: -1, direction: Direction.UP}),
        new PortDefinition("outputPortB", {x: 1, y: -1, direction: Direction.UP}),
    ],
    internalPorts: [
        new PortDefinition("internalPortA"),
        new PortDefinition("internalPortB"),
    ],
    geometry: "1x2",
    renderConnections: true,
    textureName: "splitter/1",
    label: "Splitter",
    behavior: new SplitterBehavior(),
    conveys: CONVEYS_ITEM,
});

// A road cell of the worker network; workers walk it from Housing to machines.
export const RoadType = new ObjectType({
    name: "Road",
    toolId: 5,
    geometry: "1x1",
    textureName: "road/0",
    mapColor: MAP_COLOR_ROAD,
    drawLayerIndex: DRAW_LAYER_ROAD,
    directional: false,
    label: "Road",
    behavior: new RoadBehavior(),
    placement: new PlacementRule({shouldReplaceSameKind: true, shouldDragToPlace: true}),
});

/**
 * Whether an ObjectType is the gate.
 * @param {ObjectType} type
 * @returns {boolean}
 */
export function isGateType(type) {
    return type.behavior instanceof GateBehavior;
}

const toggleGate = (entry, session, client) => client.cache.writer("logistics").toggleGate(entry.id);

// The synced `data.open`/`data.fluid` pick among four frames; the base texture is the open item
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

    getTextureByData(data) {
        if (data.fluid === 1) {
            return data.open === 0 ? this.fluidClosedTextureName : this.fluidTextureName;
        }
        return data.open === 0 ? this.closedTextureName : this.textureName;
    }
}

// A click-to-toggle flow stop facing the flow direction; adopts the kind of the first transport
// coupled to it.
export const GateType = new GateObjectType({
    name: "Gate",
    toolId: 28,
    inputPorts: [new PortDefinition("inputPort", {x: 0, y: 0, direction: Direction.UP})],
    outputPorts: [new PortDefinition("outputPort", {x: 0, y: -1, direction: Direction.UP})],
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
export const PoleType = new ObjectType({
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

const openTerminalConfig = (entry, session, client) => client.cache.writer("logistics").openTerminalConfig(entry.id);

// The config surface of a logic network; portless, wired to a pole like any device.
export const LogicTerminalType = new ObjectType({
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

export const HousingType = new ObjectType({
    name: "Housing",
    toolId: 6,
    geometry: "2x2",
    textureName: "housing/0",
    mapColor: MAP_COLOR_HOUSING,
    directional: false,
    label: "Housing",
    behavior: new HousingBehavior({workerSupply: HOUSING_WORKER_SUPPLY}),
    placement: new PlacementRule({shouldAdvanceOnPlace: false}),
});
