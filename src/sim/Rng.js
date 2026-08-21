import {WORLD_SEED_MAX} from "@/common/constants.js";

// Integer-hash mixing constants (murmur3-style finalizer); chosen for avalanche, not cryptographic
// strength.
const MULTIPLIER_A = 0x85ebca6b;
const MULTIPLIER_B = 0xc2b2ae35;

/**
 * A deterministic pseudo-random value in [0, 1) for a given (a, b) pair: same inputs always produce
 * the same result, so a chance-driven outcome (e.g. a machine's byproduct roll) reproduces
 * identically across save/reload and replay without persisting any RNG state itself.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function deterministicRoll(a, b) {
    let hash = (Math.imul(a, MULTIPLIER_A) ^ b) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 16), MULTIPLIER_A) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 13), MULTIPLIER_B) >>> 0;
    hash = (hash ^ (hash >>> 16)) >>> 0;
    return hash / 0x100000000;
}

/**
 * @param {number} seed
 * @returns {void}
 * @throws {RangeError} unless seed is an integer in [0, WORLD_SEED_MAX]
 */
export function assertWorldSeed(seed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > WORLD_SEED_MAX) {
        throw new RangeError(`World seed must be an integer in [0, ${WORLD_SEED_MAX}], got ${seed}`);
    }
}

/**
 * @returns {number} a random valid world seed
 */
export function randomWorldSeed() {
    return Math.floor(Math.random() * (WORLD_SEED_MAX + 1));
}
