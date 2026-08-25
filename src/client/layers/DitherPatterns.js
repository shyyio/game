import {tileHash} from "@/common/WorldNoise.js";
import {DITHER_CHANNEL} from "@/common/Terrain.js";

const UINT32_RANGE = 0x100000000;

// The white-noise pattern's own seed: that one pattern is a render choice, not part of the world.
const DITHER_SEED = 0x5bd1e995;

/**
 * The world the noise pattern samples; set when the seed arrives.
 * @type {Terrain|null}
 */
let ditherTerrain = null;

/**
 * @param {Terrain} terrain
 * @returns {void}
 */
export function setDitherTerrain(terrain) {
    ditherTerrain = terrain;
}

/**
 * @param {number} column
 * @param {number} row
 * @returns {number} the dither field's value at the cell, in [0, 1]
 */
function noiseThreshold(column, row) {
    if (ditherTerrain === null) {
        throw new Error("The noise dither has no terrain; setDitherTerrain() runs when the seed arrives");
    }
    return ditherTerrain.ditherAt(column, row);
}

/**
 * Retunes the shared channel, which is sampled per read, so the next repaint picks it up.
 * @param {number} scale the dither channel's frequency; bigger = finer grain
 * @returns {number} the scale now in force
 */
export function setDitherScale(scale) {
    if (!(scale > 0)) {
        throw new RangeError(`Dither scale must be > 0, got ${scale}`);
    }
    DITHER_CHANNEL.frequency = scale;
    return DITHER_CHANNEL.frequency;
}

/**
 * @returns {number}
 */
export function ditherScale() {
    return DITHER_CHANNEL.frequency;
}

// Roberts' R2 low-discrepancy sequence: the plastic-constant offsets that give it near-blue-noise
// spacing without a lookup table.
const R2_X = 0.7548776662466927;
const R2_Y = 0.5698402909980532;

// Clustered-dot 4x4: ranks spiral out from the center, so cells grow into dots instead of scattering.
const HALFTONE_SIZE = 4;
const HALFTONE_RANKS = [
    12, 5, 6, 13,
    4, 0, 1, 7,
    11, 3, 2, 8,
    15, 10, 9, 14,
];

/**
 * Doubles a Bayer matrix by quadrant: 4*M, 4*M + 2 over 4*M + 3, 4*M + 1.
 * @param {number} size a power of two
 * @returns {number[]} the ordered-Bayer ranks, row-major
 */
function bayerRanks(size) {
    let ranks = [0];
    let side = 1;
    while (side < size) {
        const width = side * 2;
        const doubled = new Array(width * width);
        for (let row = 0; row < side; row++) {
            for (let column = 0; column < side; column++) {
                const rank = ranks[row * side + column] * 4;
                doubled[row * width + column] = rank;
                doubled[row * width + column + side] = rank + 2;
                doubled[(row + side) * width + column] = rank + 3;
                doubled[(row + side) * width + column + side] = rank + 1;
            }
        }
        ranks = doubled;
        side = width;
    }
    return ranks;
}

/**
 * @param {number[]} ranks row-major, one per matrix cell
 * @param {number} size the matrix's width
 * @returns {function(number, number): number} the tiling threshold lookup they define
 */
function matrixThresholds(ranks, size) {
    const thresholds = ranks.map(rank => (rank + 0.5) / ranks.length);
    return (column, row) => {
        const x = ((column % size) + size) % size;
        const y = ((row % size) + size) % size;
        return thresholds[y * size + x];
    };
}

/**
 * A named source of dither thresholds: world cell -> the part-level that cell must beat before it
 * rounds up to the next blend level, in [0, 1].
 */
export class DitherPattern {

    /**
     * @param {string} name the console name, unique across the set
     * @param {function(number, number): number} thresholdAt column, row -> threshold in [0, 1]
     */
    constructor(name, thresholdAt) {
        this.name = name;
        this._thresholdAt = thresholdAt;
    }

    /**
     * @param {number} column world cell column
     * @param {number} row world cell row
     * @returns {number} the threshold in [0, 1]
     */
    thresholdAt(column, row) {
        return this._thresholdAt(column, row);
    }
}

// The pattern the ground paints through until something swaps it.
export const DEFAULT_DITHER_PATTERN = "noise";

// The comparison set, in console-listing order.
export const DITHER_PATTERNS = [
    new DitherPattern("bayer4", matrixThresholds(bayerRanks(4), 4)),
    new DitherPattern("bayer2", matrixThresholds(bayerRanks(2), 2)),
    new DitherPattern("bayer8", matrixThresholds(bayerRanks(8), 8)),
    new DitherPattern("halftone", matrixThresholds(HALFTONE_RANKS, HALFTONE_SIZE)),
    new DitherPattern("r2", (column, row) => {
        const value = column * R2_X + row * R2_Y;
        return value - Math.floor(value);
    }),
    new DitherPattern("white", (column, row) => tileHash(DITHER_SEED, column, row) / UINT32_RANGE),
    new DitherPattern("noise", noiseThreshold),
];

// A part-level is below 1 by definition, so this threshold is the one no cell ever beats.
const THRESHOLD_NEVER = 1;

let activePattern = DITHER_PATTERNS.find(pattern => pattern.name === DEFAULT_DITHER_PATTERN);
let ditherEnabled = true;

/**
 * @returns {DitherPattern} the pattern the ground currently paints through
 */
export function activeDither() {
    return activePattern;
}

/**
 * @param {string} name one of {@link DITHER_PATTERNS}
 * @returns {DitherPattern} the pattern now active
 */
export function setActiveDither(name) {
    const pattern = DITHER_PATTERNS.find(candidate => candidate.name === name);
    if (pattern === undefined) {
        throw new Error(`Unknown dither pattern "${name}"; try one of: ${DITHER_PATTERNS.map(each => each.name).join(", ")}`);
    }
    activePattern = pattern;
    return pattern;
}

/**
 * @param {boolean} enabled whether the active pattern applies at all; off, blend levels step flat
 * @returns {void}
 */
export function setDitherEnabled(enabled) {
    ditherEnabled = enabled;
}

/**
 * @returns {boolean}
 */
export function ditherOn() {
    return ditherEnabled;
}

/**
 * Reads through the active pattern, so a swap takes effect on the next repaint.
 * @param {number} column world cell column
 * @param {number} row world cell row
 * @returns {number} the threshold in [0, 1]
 */
export function ditherThreshold(column, row) {
    if (!ditherEnabled) {
        return THRESHOLD_NEVER;
    }
    return activePattern.thresholdAt(column, row);
}
