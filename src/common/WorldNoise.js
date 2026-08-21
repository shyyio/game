import {createNoise2D} from "simplex-noise";
import {WORLD_SEED_MAX} from "@/common/constants.js";

// Golden-ratio increment and murmur3 finalizer constants; chosen for avalanche, not secrecy.
const GOLDEN_GAMMA = 0x9e3779b9;
const MIX_A = 0x85ebca6b;
const MIX_B = 0xc2b2ae35;
const SPLITMIX_A = 0x21f0aaad;
const SPLITMIX_B = 0x735a2d97;
const UINT32_RANGE = 0x100000000;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

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

/**
 * @param {number} n
 * @returns {number} n avalanched to a uint32
 */
function mix32(n) {
    let hash = n >>> 0;
    hash = Math.imul(hash ^ (hash >>> 16), MIX_A) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 13), MIX_B) >>> 0;
    return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * splitmix32: a tiny seeded PRNG yielding [0, 1); feeds simplex-noise's permutation shuffle.
 * @param {number} state
 * @returns {function(): number}
 */
function splitmix32(state) {
    let a = state >>> 0;
    return () => {
        a = (a + GOLDEN_GAMMA) | 0;
        let t = a ^ (a >>> 16);
        t = Math.imul(t, SPLITMIX_A);
        t = t ^ (t >>> 15);
        t = Math.imul(t, SPLITMIX_B);
        t = t ^ (t >>> 15);
        return (t >>> 0) / UINT32_RANGE;
    };
}

/**
 * A seeded per-tile hash for deterministic scatter (shade variants, detail placement): same seed
 * and tile, same value, on sim and client alike.
 * @param {number} seed
 * @param {number} tileX
 * @param {number} tileY
 * @returns {number} uint32
 */
export function tileHash(seed, tileX, tileY) {
    return mix32(mix32(seed ^ Math.imul(tileX, MIX_A)) ^ Math.imul(tileY, MIX_B));
}

/**
 * @param {string} text
 * @returns {number} a uint32 hash of the string (FNV-1a)
 */
function hashString(text) {
    let hash = FNV_OFFSET;
    for (let i = 0; i < text.length; i++) {
        hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME) >>> 0;
    }
    return hash;
}

/**
 * Seeded 2D simplex noise, one independent fBm field per declared NoiseChannel. Pure integer/float
 * math, so sim and client derive identical terrain from the shared seed alone.
 */
export class WorldNoise {

    /**
     * @param {number} seed
     * @param {NoiseChannel[]} channels in channelId order (ModRegistry.noiseChannels)
     */
    constructor(seed, channels) {
        assertWorldSeed(seed);
        this.seed = seed;
        this.channels = channels;

        /**
         * Raw simplex field per channel, indexed by channelId.
         * @type {Array<function(number, number): number>}
         * @private
         */
        this._fields = channels.map(
            channel => createNoise2D(splitmix32(mix32(seed) ^ hashString(channel.name))),
        );
    }

    /**
     * @param {number} x tile position
     * @param {number} y tile position
     * @param {number} channelId
     * @returns {number} the channel's fBm noise in [0, 1]
     */
    get(x, y, channelId) {
        const field = this._fields[channelId];
        if (field === undefined) {
            throw new RangeError(`No noise channel ${channelId}`);
        }
        const channel = this.channels[channelId];
        let sum = 0;
        let norm = 0;
        let amplitude = 1;
        let frequency = channel.frequency;
        for (let octave = 0; octave < channel.octaves; octave++) {
            sum += amplitude * field(x * frequency, y * frequency);
            norm += amplitude;
            frequency *= channel.lacunarity;
            amplitude *= channel.persistence;
        }
        return (sum / norm + 1) / 2;
    }
}
