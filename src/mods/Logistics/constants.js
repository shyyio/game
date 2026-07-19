// Numeric constants and enums for the Logistics mod. These are shared across the
// mod's ECS systems, its events, and its imperative logic, so they live in one
// place no other module redefines.

// Maximum number of tiles an underground belt may span.
export const MAX_UNDERGROUND_LENGTH = 4;

// ---- Belt types ----
export const BELT_NORMAL = 0;
export const BELT_RAMP_DOWN = 1;
export const BELT_RAMP_UP = 2;
export const BELT_UNDERGROUND = 3;

/**
 * A belt kind ordinal.
 * @typedef {number} BeltType
 */

export const BeltType = {
    NORMAL: BELT_NORMAL,
    RAMP_DOWN: BELT_RAMP_DOWN,
    RAMP_UP: BELT_RAMP_UP,
    UNDERGROUND: BELT_UNDERGROUND,
};

// Position layers for underground belts: one per axis, alongside the shared surface layer, so a
// surface belt and two crossing tunnels coexist on a tile. Layer = LAYERS_UNDERGROUND_AXIS[direction % 2].
export const LAYERS_UNDERGROUND_AXIS = ["U0", "U1"];

/**
 * A belt bend ordinal.
 * @typedef {number} BeltBend
 */

export const BeltBend = {
    STRAIGHT: 0,
    LEFT: 1,
    RIGHT: 2,
};

// ---- Labor ----
// Labor one Housing contributes to its road network.
export const HOUSING_LABOR_SUPPLY = 5;

// Map-mode tile colors.
export const MAP_COLOR_HOUSING = 0x55a355;
export const MAP_COLOR_ROAD = 0xFFBF00;

// Roads draw below the worker figures (19) and the default object sprites (20).
export const DRAW_LAYER_ROAD = 18;

// ---- System ordering ----
// The splitter's POST_RESOLVE seam runs at this order so it reads shared ports before the belt
// transport (default order 0) writes pops, whatever the registration sequence.
export const ORDER_BEFORE_TRANSPORT = -10;
