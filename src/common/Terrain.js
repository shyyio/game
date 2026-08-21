import {CHUNK_SIZE, REGION_SIZE} from "@/common/constants.js";
import {chunkOrigin} from "@/common/util.js";
import {NoiseChannel} from "@/common/NoiseChannel.js";

// Blending: a tile within BLEND_WIDTH of a threshold mixes toward the biome across it, up to 50/50
// at the line, in BLEND_LEVELS steps so the palette stays stepped.
export const BLEND_WIDTH = 0.03;
export const BLEND_LEVELS = 4;
const BLEND_MAX = 0.5;

/**
 * A baked grid of biome ids, with the blend toward each cell's nearest competing biome when baked
 * with blending (chunks); the overworld bakes flat.
 */
export class TerrainBake {

    /**
     * @param {number} cellCount
     * @param {boolean} blended
     */
    constructor(cellCount, blended) {
        this.biomes = new Uint8Array(cellCount);
        /**
         * @type {Uint8Array|null} the biome each cell blends toward
         */
        this.others = blended ? new Uint8Array(cellCount) : null;
        /**
         * @type {Uint8Array|null} blend level in [0, BLEND_LEVELS]; level / (2 * BLEND_LEVELS) = weight
         */
        this.levels = blended ? new Uint8Array(cellCount) : null;
    }
}

/**
 * One tile's classification, reused across calls.
 */
export class TileBiome {

    constructor() {
        this.biomeId = 0;
        this.otherId = 0;
        this.level = 0;
    }
}

// The engine's own channel: smooth patches that shade tiles within a biome (client rendering).
export const SHADE_CHANNEL = new NoiseChannel("shade", 0.03, 2);
export const CORE_NOISE_CHANNELS = [SHADE_CHANNEL];

const TILES_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE;

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
         * The region at overworld resolution, flat, filled row by row by {@link bakeOverworldRows}.
         * @type {TerrainBake}
         */
        this.overworldBake = new TerrainBake(OVERWORLD_CELLS_PER_AXIS * OVERWORLD_CELLS_PER_AXIS, false);
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
        let weight = 0;
        for (let index = 0; index < winner; index++) {
            const missedBy = -margins[index];
            if (missedBy < BLEND_WIDTH) {
                const candidate = BLEND_MAX * (1 - missedBy / BLEND_WIDTH);
                if (candidate > weight) {
                    weight = candidate;
                    tile.otherId = index;
                }
            }
        }
        if (margins[winner] < BLEND_WIDTH) {
            const candidate = BLEND_MAX * (1 - margins[winner] / BLEND_WIDTH);
            if (candidate > weight) {
                let next = winner + 1;
                while (margins[next] < 0) {
                    next++;
                }
                weight = candidate;
                tile.otherId = next;
            }
        }
        tile.level = Math.round(weight / BLEND_MAX * BLEND_LEVELS);
        return tile;
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
        bake = new TerrainBake(TILES_PER_CHUNK, true);
        let index = 0;
        for (let localY = 0; localY < CHUNK_SIZE; localY++) {
            for (let localX = 0; localX < CHUNK_SIZE; localX++) {
                const tile = this.classify(origin.x + localX, origin.y + localY);
                bake.biomes[index] = tile.biomeId;
                bake.others[index] = tile.otherId;
                bake.levels[index] = tile.level;
                index++;
            }
        }
        this._bakes.set(chunk, bake);
        return bake;
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
     * @returns {boolean} whether every overworld row is baked
     */
    get overworldBaked() {
        return this._overworldRowsBaked === OVERWORLD_CELLS_PER_AXIS;
    }

    /**
     * Bakes the next rows of {@link overworldBake}, one biome sample per cell center, so a caller
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
                this.overworldBake.biomes[index] = this.biomeAt(tileX, tileY);
                index++;
            }
        }
        this._overworldRowsBaked = end;
        return first;
    }

    /**
     * How comfortably a biome's ranges hold at the tile: the smallest distance from a sample to its
     * range edge, negative when a range fails (by the worst miss), +Infinity for an unconditional
     * biome. Samples each channel at most once per tile.
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
            margin = Math.min(margin, value - range.min, range.max - value);
        }
        return margin;
    }
}
