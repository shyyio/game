import {test} from "node:test";
import assert from "node:assert/strict";
import {DITHER_PATTERNS, DEFAULT_DITHER_PATTERN, activeDither, setActiveDither, setDitherEnabled, ditherOn, setDitherScale, ditherScale, setDitherTerrain, ditherThreshold} from "@/client/layers/DitherPatterns.js";
import {Terrain} from "@/common/Terrain.js";
import {WorldNoise} from "@/common/WorldNoise.js";
import {ecsModRegistry} from "@/test/ecsSim.js";

const DEFAULT_PATTERN = DEFAULT_DITHER_PATTERN;

// The noise pattern samples the world, so every pattern needs a seeded terrain to answer at all.
const registry = ecsModRegistry();
setDitherTerrain(new Terrain(new WorldNoise(7, registry.noiseChannels), registry.biomes));

/**
 * @param {DitherPattern} pattern
 * @param {number} side the square of cells to sample
 * @returns {number[]} the pattern's thresholds over a side x side block straddling the origin
 */
function sample(pattern, side) {
    const thresholds = [];
    for (let row = -side / 2; row < side / 2; row++) {
        for (let column = -side / 2; column < side / 2; column++) {
            thresholds.push(pattern.thresholdAt(column, row));
        }
    }
    return thresholds;
}

test("every pattern thresholds in [0, 1] and averages near the middle", () => {
    for (const pattern of DITHER_PATTERNS) {
        const thresholds = sample(pattern, 32);
        for (const threshold of thresholds) {
            assert.ok(threshold >= 0 && threshold <= 1, `${pattern.name} gave ${threshold}`);
        }
        const mean = thresholds.reduce((total, threshold) => total + threshold, 0) / thresholds.length;
        assert.ok(Math.abs(mean - 0.5) < 0.05, `${pattern.name} mean ${mean}`);
    }
});

test("every pattern answers the same for the same cell", () => {
    for (const pattern of DITHER_PATTERNS) {
        assert.deepEqual(sample(pattern, 8), sample(pattern, 8));
    }
});

test("the bayer matrices disperse: no cell shares its neighbor's threshold", () => {
    for (const name of ["bayer2", "bayer4", "bayer8"]) {
        const pattern = DITHER_PATTERNS.find(candidate => candidate.name === name);
        for (let row = -4; row < 4; row++) {
            for (let column = -4; column < 4; column++) {
                const threshold = pattern.thresholdAt(column, row);
                assert.notEqual(threshold, pattern.thresholdAt(column + 1, row), `${name} at ${column},${row}`);
                assert.notEqual(threshold, pattern.thresholdAt(column, row + 1), `${name} at ${column},${row}`);
            }
        }
    }
});

test("bayer4 holds the classic dispersed ranks", () => {
    const pattern = DITHER_PATTERNS.find(candidate => candidate.name === "bayer4");
    const ranks = [];
    for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 4; column++) {
            ranks.push(Math.round(pattern.thresholdAt(column, row) * 16 - 0.5));
        }
    }
    assert.deepEqual(ranks, [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
});

test("the matrix patterns tile, negative coordinates included", () => {
    for (const name of ["bayer4", "bayer8", "halftone"]) {
        const pattern = DITHER_PATTERNS.find(candidate => candidate.name === name);
        const period = {bayer4: 4, bayer8: 8, halftone: 4}[name];
        for (const [column, row] of [[0, 0], [1, 3], [-1, -7], [5, -2]]) {
            assert.equal(pattern.thresholdAt(column, row), pattern.thresholdAt(column + period, row));
            assert.equal(pattern.thresholdAt(column, row), pattern.thresholdAt(column, row - period));
        }
    }
});

test("switched off, no cell can beat its threshold, whatever the pattern", () => {
    try {
        setActiveDither("r2");
        setDitherEnabled(false);
        assert.equal(ditherOn(), false);
        // A part-level is below 1 by definition, so a threshold of 1 is never beaten.
        assert.equal(ditherThreshold(3, -9), 1);
        assert.equal(ditherThreshold(0, 0), 1);
        // The pattern is remembered, so switching back needs no re-pick.
        assert.equal(activeDither().name, "r2");
        setDitherEnabled(true);
        assert.equal(ditherThreshold(3, -9), activeDither().thresholdAt(3, -9));
    } finally {
        setDitherEnabled(true);
        setActiveDither(DEFAULT_PATTERN);
    }
});

test("setActiveDither swaps what ditherThreshold reads, and refuses an unknown name", () => {
    try {
        const fallback = DITHER_PATTERNS.find(candidate => candidate.name === DEFAULT_PATTERN);
        const swapped = setActiveDither("r2");
        assert.notEqual(swapped, fallback);
        assert.equal(activeDither(), swapped);
        assert.equal(ditherThreshold(2, 5), swapped.thresholdAt(2, 5));
        assert.notEqual(ditherThreshold(2, 5), fallback.thresholdAt(2, 5));
        assert.throws(() => setActiveDither("floyd"), /Unknown dither pattern "floyd".*bayer4/s);
        // The failed swap left the last good pattern in place.
        assert.equal(activeDither(), swapped);
    } finally {
        setActiveDither(DEFAULT_PATTERN);
    }
});

test("the dither scale retunes the noise field, and refuses a non-positive one", () => {
    const pattern = DITHER_PATTERNS.find(candidate => candidate.name === "noise");
    const before = ditherScale();
    try {
        const coarse = [pattern.thresholdAt(0, 0), pattern.thresholdAt(8, 3)];
        assert.equal(setDitherScale(2), 2);
        assert.notDeepEqual([pattern.thresholdAt(0, 0), pattern.thresholdAt(8, 3)], coarse);
        // Back to the old scale, back to the old field: the seed never moves.
        setDitherScale(before);
        assert.deepEqual([pattern.thresholdAt(0, 0), pattern.thresholdAt(8, 3)], coarse);
        assert.throws(() => setDitherScale(0), /must be > 0/);
        assert.throws(() => setDitherScale(-1), /must be > 0/);
    } finally {
        setDitherScale(before);
    }
});

test("the noise pattern refuses to answer before the seed arrives", () => {
    const pattern = DITHER_PATTERNS.find(candidate => candidate.name === "noise");
    const terrain = new Terrain(new WorldNoise(7, registry.noiseChannels), registry.biomes);
    try {
        setDitherTerrain(null);
        assert.throws(() => pattern.thresholdAt(0, 0), /no terrain/);
    } finally {
        setDitherTerrain(terrain);
    }
});
