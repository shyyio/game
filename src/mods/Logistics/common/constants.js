import {Direction, LAYER_SURFACE} from "@spup/sdk";

// Shared numeric constants and enums for the Logistics mod.

// Maximum tiles an underground belt may span.
export const MAX_UNDERGROUND_LENGTH = 4;

// ---- Belt types ----
export const BELT_NORMAL = 0;
export const BELT_TUNNEL_DOWN = 1;
export const BELT_TUNNEL_UP = 2;
export const BELT_UNDERGROUND = 3;

/**
 * A belt kind ordinal (one of the BELT_* constants).
 * @typedef {number} BeltType
 */

// Underground position layers, one per axis (LAYERS_UNDERGROUND_AXIS[direction % 2]), so a
// surface belt and two crossing tunnels coexist on a tile.
export const LAYERS_UNDERGROUND_AXIS = ["U0", "U1"];

/**
 * The position layer a belt sits on: undergrounds get their axis layer, everything else SURFACE.
 * @param {BeltType} type
 * @param {Direction} direction
 * @returns {string}
 */
export function beltPositionLayer(type, direction) {
    if (type === BELT_UNDERGROUND) {
        return LAYERS_UNDERGROUND_AXIS[direction % 2];
    }
    return LAYER_SURFACE;
}

/**
 * Per-step (dx, dy) for walking a mouth's tunnel: TUNNEL_UP steps against its facing, TUNNEL_DOWN along it.
 * @param {number} mouthType BELT_TUNNEL_UP or BELT_TUNNEL_DOWN
 * @param {Direction} direction the mouth's facing
 * @returns {{dx: number, dy: number}}
 */
export function tunnelStep(mouthType, direction) {
    const sign = mouthType === BELT_TUNNEL_UP ? -1 : 1;
    return {dx: sign * Direction.dx(direction), dy: sign * Direction.dy(direction)};
}

/**
 * A belt bend ordinal.
 * @typedef {number} BeltBend
 */

export const BeltBend = {
    STRAIGHT: 0,
    LEFT: 1,
    RIGHT: 2,
};

// ---- Workers ----
// Workers one Housing contributes to its road network.
export const HOUSING_WORKER_SUPPLY = 5;

// Map-mode tile colors.
export const MAP_COLOR_HOUSING = 0x55a355;
export const MAP_COLOR_ROAD = 0xFFBF00;
export const MAP_COLOR_BELT = 0xf7df9e;
export const MAP_COLOR_BELT_TUNNEL = 0xc8a16e;

// Roads draw below the worker figures (19) and the default object sprites (20).
export const DRAW_LAYER_ROAD = 18;

// Wire catenaries draw above objects and fills.
export const DRAW_LAYER_WIRES = 30;

// ---- Control network ----
// Poles auto-link to poles within this chebyshev range; device wires obey the same reach.
export const POLE_LINK_RANGE = 10;

// ControlLink.pole value for an unwired device.
export const POLE_NONE = 0;

// Save-record table of pole-pole wires.
export const CONTROL_WIRE_RECORD = "ControlWire";

// A terminal's starting tier.
export const CONTROL_TIER_BASE = 1;

/**
 * Whether two tiles are within wire reach of each other.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {boolean}
 */
export function withinPoleRange(x1, y1, x2, y2) {
    return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)) <= POLE_LINK_RANGE;
}

// ---- System ordering ----
// Splitter's POST_RESOLVE seam reads shared ports before belt transport (default order 0) writes pops.
export const ORDER_BEFORE_TRANSPORT = -10;
