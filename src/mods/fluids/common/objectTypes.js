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
export const PipeType = new ObjectType({
    name: "Pipe",
    toolId: 7,
    geometry: "1x1",
    textureName: "pipe/0",
    directional: false,
    label: "Pipe",
    behavior: new PipeBehavior(),
    placement: new PlacementRule({shouldDragToPlace: true}),
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

// Fed from below at its bottom-left tile, emitting above its top-right; the fluid output port opts
// out of item rendering.
export const TankType = new ObjectType({
    name: "Tank",
    toolId: 8,
    inputPorts: [
        new PortDefinition("inputPort", {x: 0, y: 1, direction: Direction.UP}),
    ],
    outputPorts: [
        new PortDefinition("outputPort", {x: 1, y: -1, direction: Direction.UP}, false),
    ],
    geometry: "2x2",
    renderConnections: true,
    textureName: "tank/0",
    label: "Tank",
    behavior: new TankBehavior({capacity: TANK_CAPACITY}),
    wireAnchor: {x: 0.5, y: 0.2},
});
