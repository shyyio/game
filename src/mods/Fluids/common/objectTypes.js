import {
    ObjectType,
    PortDefinition,
    PlacementRule,
    Direction,
    CONVEYS_FLUID,
} from "@spup/sdk";
import {TANK_CAPACITY} from "./constants.js";
import {PipeBehavior} from "../sim/PipeBehavior.js";
import {TankBehavior} from "../sim/TankBehavior.js";

// Portless: the network derives boundary ports from adjacency.
export const PipeDefinition = new ObjectType({
    name: "Pipe",
    toolId: 7,
    geometry: "1x1",
    textureName: "pipe/0",
    directional: false,
    label: "Pipe",
    behavior: new PipeBehavior(),
    placement: new PlacementRule({dragToPlace: true}),
    conveys: CONVEYS_FLUID,
});

/**
 * Whether an ObjectType is the pipe.
 * @param {ObjectType} type
 * @returns {boolean}
 */
export function isPipeType(type) {
    return type.behavior instanceof PipeBehavior;
}

/**
 * Whether an ObjectType is the tank.
 * @param {ObjectType} type
 * @returns {boolean}
 */
export function isTankType(type) {
    return type.behavior instanceof TankBehavior;
}

// Fed from below at its bottom-left tile, emitting above its top-right; the fluid out-port opts
// out of item rendering.
export const TankDefinition = new ObjectType({
    name: "Tank",
    toolId: 8,
    inputPorts: [
        new PortDefinition("in", {x: 0, y: 1, direction: Direction.UP}),
    ],
    outputPorts: [
        new PortDefinition("out", {x: 1, y: -1, direction: Direction.UP}, false),
    ],
    geometry: "2x2",
    renderConnections: true,
    textureName: "tank/0",
    label: "Tank",
    behavior: new TankBehavior({capacity: TANK_CAPACITY}),
});
