import {Direction, LAYER_SURFACE} from "@/sdk/common.js";

// Shared numeric constants and enums for the Logistics mod.

// Maximum tiles an underground belt may span.
export const MAX_UNDERGROUND_LENGTH = 4;

// ---- Belt types ----
export const BELT_NORMAL = 0;
export const BELT_RAMP_DOWN = 1;
export const BELT_RAMP_UP = 2;
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
 * Per-step (dx, dy) for walking a ramp's tunnel: RAMP_UP steps against its facing, RAMP_DOWN along it.
 * @param {number} rampType BELT_RAMP_UP or BELT_RAMP_DOWN
 * @param {Direction} direction the ramp's facing
 * @returns {{dx: number, dy: number}}
 */
export function tunnelStep(rampType, direction) {
    const sign = rampType === BELT_RAMP_UP ? -1 : 1;
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

// Roads draw below the worker figures (19) and the default object sprites (20).
export const DRAW_LAYER_ROAD = 18;

// ---- System ordering ----
// Splitter's POST_RESOLVE seam reads shared ports before belt transport (default order 0) writes pops.
export const ORDER_BEFORE_TRANSPORT = -10;
