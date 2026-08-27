import {CHUNK_SIZE, REGION_SIZE} from "@/common/constants.js";
import {chunkOrigin} from "@/common/util.js";
import {NoiseChannel} from "@/common/NoiseChannel.js";
import {tileHash} from "@/common/WorldNoise.js";

const UINT32_RANGE = 0x100000000;

// Blending: a tile within the blend width of a threshold mixes toward the biome across it, up to
// 50/50 at the line. A bake carries the weight at BLEND_WEIGHT_SCALE resolution; the client bands it
// into BLEND_LEVELS steps so the palette stays stepped.
export const BLEND_WIDTH = 0.04;
export const BLEND_LEVELS = 3;
export const BLEND_WEIGHT_SCALE = 255;
const BLEND_MAX = 0.5;

// Retuned by the terrain tuner; a change invalidates every bake.
let activeBlendWidth = BLEND_WIDTH;

/**
 * @param {number} width how close to a threshold a tile starts blending
 * @returns {number} the width now in force
 * @throws {RangeError} unless width is > 0
 */
export function setBlendWidth(width) {
    if (!(width > 0)) {
        throw new RangeError(`Blend width must be > 0, got ${width}`);
    }
    activeBlendWidth = width;
    return activeBlendWidth;
}

/**
 * @returns {number}
 */
export function blendWidth() {
    return activeBlendWidth;
}

/**
 * A baked grid of biome ids, with the blend toward each cell's nearest competing biome when baked
 * with blending.
 */
export class TerrainBake {

    /**
     * @param {number} cellsPerAxis the bake is square
     * @param {boolean} blended
     */
    constructor(cellsPerAxis, blended) {
        const cellCount = cellsPerAxis * cellsPerAxis;
        this.cellsPerAxis = cellsPerAxis;
        this.biomes = new Uint8Array(cellCount);
        /**
         * @type {Uint8Array|null} the biome each cell blends toward
         */
        this.others = blended ? new Uint8Array(cellCount) : null;
        /**
         * @type {Uint8Array|null} blend weight in [0, BLEND_WEIGHT_SCALE]; the scale is a 50/50 mix
         */
        this.weights = blended ? new Uint8Array(cellCount) : null;
    }
}

/**
 * One tile's classification, reused across calls.
 */
export class TileBiome {

    constructor() {
        this.biomeId = 0;
        this.otherId = 0;
        this.weight = 0;
    }
}

// The engine's own channels, both for client rendering: smooth patches that shade tiles within a
// biome, and the field the noise dither thresholds a blend against.
export const SHADE_CHANNEL = new NoiseChannel("shade", 0.02, 2);
export const DITHER_CHANNEL = new NoiseChannel("dither", 0.17);
export const CORE_NOISE_CHANNELS = [SHADE_CHANNEL, DITHER_CHANNEL];

// The overworld bake's resolution: one cell per OVERWORLD_CELL_TILES² tiles, sampled at the center.
export const OVERWORLD_CELL_TILES = 16;
export const OVERWORLD_CELLS_PER_AXIS = (REGION_SIZE * CHUNK_SIZE) / OVERWORLD_CELL_TILES;
const OVERWORLD_ORIGIN_TILE = -(REGION_SIZE * CHUNK_SIZE) / 2;
const OVERWORLD_CELL_CENTER = OVERWORLD_CELL_TILES / 2;

/**
 * Tile -> biome over a seeded WorldNoise and the loadout's biomes. Sim and client each hold one;
 * same seed, same biomes, same answer, so terrain never crosses the wire.
 */
export class Terrain {

    /**
     * @param {WorldNoise} noise
     * @param {Biome[]} biomes in biomeId order (ModRegistry.biomes)
     */
    constructor(noise, biomes) {
        this.noise = noise;
        this.biomes = biomes;

        /**
         * chunk -> its bake, row-major within the chunk.
         * @type {Map<number, TerrainBake>}
         * @private
         */
        this._bakes = new Map();
        /**
         * The region at overworld resolution, filled row by row by {@link bakeOverworldRows}.
         * @type {TerrainBake}
         */
        this.overworldBake = new TerrainBake(OVERWORLD_CELLS_PER_AXIS, true);
        this._overworldRowsBaked = 0;
        // Scratch: the channel samples and per-biome margins of the tile under evaluation.
        this._samples = new Float64Array(noise.channels.length);
        this._margins = new Float64Array(biomes.length);
        this._tile = new TileBiome();
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @returns {number} the biomeId of the first biome whose ranges all hold
     */
    biomeAt(tileX, tileY) {
        return this.classify(tileX, tileY).biomeId;
    }

    /**
     * The tile's biome plus its blend: toward the rejected biome it most nearly matched, or toward
     * the next matching biome when its own match is thin, whichever is closer.
     * @param {number} tileX
     * @param {number} tileY
     * @returns {TileBiome} a shared scratch record, valid until the next call
     */
    classify(tileX, tileY) {
        if (this.biomes.length === 0) {
            throw new Error("Terrain.classify: the loadout declares no biomes");
        }
        const samples = this._samples;
        samples.fill(NaN);
        // The biome set is mutable (the terrain tuner adds and removes biomes); resize to match.
        if (this._margins.length !== this.biomes.length) {
            this._margins = new Float64Array(this.biomes.length);
        }
        const margins = this._margins;
        let winner = -1;
        for (const [index, biome] of this.biomes.entries()) {
            margins[index] = this._margin(biome, tileX, tileY, samples);
            if (winner === -1 && margins[index] >= 0) {
                winner = index;
            }
        }
        if (winner === -1) {
            // Unreachable: freeze guarantees the last biome is unconditional.
            throw new Error(`Terrain.classify: no biome matches tile ${tileX},${tileY}`);
        }
        const tile = this._tile;
        tile.biomeId = winner;
        tile.otherId = winner;
        const winnerWidth = this._blendWidthOf(winner);
        let weight = 0;
        for (let index = 0; index < winner; index++) {
            const missedBy = -margins[index];
            const width = Math.min(winnerWidth, this._blendWidthOf(index));
            if (missedBy < width) {
                const candidate = BLEND_MAX * (1 - missedBy / width);
                if (candidate > weight) {
                    weight = candidate;
                    tile.otherId = index;
                }
            }
        }
        // winnerWidth bounds the pair width, so a margin at or past it cannot blend.
        if (margins[winner] < winnerWidth) {
            let next = winner + 1;
            while (margins[next] < 0) {
                next++;
            }
            const width = Math.min(winnerWidth, this._blendWidthOf(next));
            if (margins[winner] < width) {
                const candidate = BLEND_MAX * (1 - margins[winner] / width);
                if (candidate > weight) {
                    weight = candidate;
                    tile.otherId = next;
                }
            }
        }
        tile.weight = Math.round(weight / BLEND_MAX * BLEND_WEIGHT_SCALE);
        return tile;
    }

    /**
     * @private
     * @param {number} index into the biome list
     * @returns {number} the biome's blend width, or the global width when it declares none
     */
    _blendWidthOf(index) {
        const width = this.biomes[index].blendWidth;
        if (width === null) {
            return activeBlendWidth;
        }
        return width;
    }

    /**
     * @param {number} chunk
     * @returns {TerrainBake} the chunk's tiles with blends, index = localY * CHUNK_SIZE + localX; cached
     */
    bakeChunk(chunk) {
        let bake = this._bakes.get(chunk);
        if (bake !== undefined) {
            return bake;
        }
        const origin = chunkOrigin(chunk);
        bake = new TerrainBake(CHUNK_SIZE, true);
        let index = 0;
        for (let localY = 0; localY < CHUNK_SIZE; localY++) {
            for (let localX = 0; localX < CHUNK_SIZE; localX++) {
                const tile = this.classify(origin.x + localX, origin.y + localY);
                bake.biomes[index] = tile.biomeId;
                bake.others[index] = tile.otherId;
                bake.weights[index] = tile.weight;
                index++;
            }
        }
        this._bakes.set(chunk, bake);
        return bake;
    }

    /**
     * Drops every cached bake so the next paint reclassifies: a channel, biome or blend retune.
     * @returns {void}
     */
    invalidate() {
        this._bakes.clear();
        this._overworldRowsBaked = 0;
    }

    /**
     * The decoration a tile of the given biome carries, rolled from the seeded tile hash against the
     * biome's detail densities; same answer on sim and client.
     * @param {Biome} biome the tile's biome
     * @param {number} tileX
     * @param {number} tileY
     * @returns {TerrainDetail|null}
     */
    detailFor(biome, tileX, tileY) {
        if (biome.details.length === 0) {
            return null;
        }
        const roll = tileHash(this.noise.seed, tileX, tileY) / UINT32_RANGE;
        let cumulative = 0;
        for (const detail of biome.details) {
            cumulative += detail.density;
            if (roll < cumulative) {
                return detail;
            }
        }
        return null;
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @returns {number} the shade noise in [0, 1]
     */
    shadeAt(tileX, tileY) {
        return this.noise.get(tileX, tileY, SHADE_CHANNEL.channelId);
    }

    /**
     * @param {number} x bake cell, a tile in world and map mode
     * @param {number} y bake cell, a tile in world and map mode
     * @returns {number} the dither noise in [0, 1]
     */
    ditherAt(x, y) {
        return this.noise.get(x, y, DITHER_CHANNEL.channelId);
    }

    /**
     * @returns {boolean} whether every overworld row is baked
     */
    get overworldBaked() {
        return this._overworldRowsBaked === OVERWORLD_CELLS_PER_AXIS;
    }

    /**
     * Bakes the next rows of {@link overworldBake}, one classification per cell center, so a caller
     * can spread the region over several frames.
     * @param {number} rowCount
     * @returns {number} the first row baked (rows [first, first + rowCount) are now current)
     */
    bakeOverworldRows(rowCount) {
        const first = this._overworldRowsBaked;
        const end = Math.min(first + rowCount, OVERWORLD_CELLS_PER_AXIS);
        for (let row = first; row < end; row++) {
            const tileY = OVERWORLD_ORIGIN_TILE + row * OVERWORLD_CELL_TILES + OVERWORLD_CELL_CENTER;
            let index = row * OVERWORLD_CELLS_PER_AXIS;
            for (let column = 0; column < OVERWORLD_CELLS_PER_AXIS; column++) {
                const tileX = OVERWORLD_ORIGIN_TILE + column * OVERWORLD_CELL_TILES + OVERWORLD_CELL_CENTER;
                const tile = this.classify(tileX, tileY);
                this.overworldBake.biomes[index] = tile.biomeId;
                this.overworldBake.others[index] = tile.otherId;
                this.overworldBake.weights[index] = tile.weight;
                index++;
            }
        }
        this._overworldRowsBaked = end;
        return first;
    }

    /**
     * How comfortably a biome's ranges hold at the tile: the smallest distance from a sample to a
     * range edge, negative when a range fails (by the worst miss), +Infinity for an unconditional
     * biome. Edges at 0 or 1 bound nothing (noise never crosses them) and don't count, so a range
     * like [0, 0.4] only blends at 0.4. Samples each channel at most once per tile.
     * @private
     * @param {Biome} biome
     * @param {number} tileX
     * @param {number} tileY
     * @param {Float64Array} samples
     * @returns {number}
     */
    _margin(biome, tileX, tileY, samples) {
        let margin = Infinity;
        for (const range of biome.ranges) {
            const channelId = range.channel.channelId;
            let value = samples[channelId];
            if (Number.isNaN(value)) {
                value = this.noise.get(tileX, tileY, channelId);
                samples[channelId] = value;
            }
            if (range.min > 0) {
                margin = Math.min(margin, value - range.min);
            }
            if (range.max < 1) {
                margin = Math.min(margin, range.max - value);
            }
        }
        return margin;
    }
}
