import {Direction, EMPTY} from "@spup/sdk";

// Shared numeric constants for the Fluids mod.

// Neighbor scan order for network adjacency.
export const DIRECTIONS = [Direction.UP, Direction.RIGHT, Direction.DOWN, Direction.LEFT];

/**
 * Folds the fluid-type candidates around a prospective pipe tile; the sim and client feed their
 * own lookups so the join rule lives once.
 * @param {function(Direction): number[]} candidatesAt
 * @returns {number|null} the single joined type (EMPTY when none), or null on a conflict
 */
export function joinedFluidType(candidatesAt) {
    let fluidType = EMPTY;
    for (const direction of DIRECTIONS) {
        for (const candidate of candidatesAt(direction)) {
            if (candidate === EMPTY) {
                continue;
            }
            if (fluidType !== EMPTY && fluidType !== candidate) {
                return null;
            }
            fluidType = candidate;
        }
    }
    return fluidType;
}

// ---- Fluid types ----
// Mod-owned numbers, same convention as item types; a network adopts whatever number lands in
// its ports.
export const FLUID_TYPE_WATER = 230;
export const FLUID_TYPE_OIL = 231;

/**
 * A fluid type ordinal.
 * @typedef {number} FluidType
 */

// Units per port payload per tick; a typical 100-unit recipe is ten payloads.
export const FLUID_UNIT = 10;

// Units one pipe segment buffers; a network's capacity is its segment count times this.
export const PIPE_SEGMENT_CAPACITY = 100;

// Units one tank holds.
export const TANK_CAPACITY = 1000;

// Map-mode / fill colors by fluid type.
const FLUID_COLORS = {
    [FLUID_TYPE_WATER]: 0x3f8fd2,
    [FLUID_TYPE_OIL]: 0x2b2620,
};

// Fill color for fluid numbers without an entry.
const DEFAULT_FLUID_COLOR = 0x62b6cb;

/**
 * The fill color for a fluid type.
 * @param {FluidType} fluidType
 * @returns {number}
 */
export function fluidColor(fluidType) {
    const color = FLUID_COLORS[fluidType];
    if (color === undefined) {
        return DEFAULT_FLUID_COLOR;
    }
    return color;
}

// The fluid overlay draws above the default object sprites (20).
export const DRAW_LAYER_PIPE_FLUID = 21;
