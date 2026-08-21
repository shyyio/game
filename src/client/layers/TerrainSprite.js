import {BufferImageSource, Sprite, Texture} from "pixi.js";
import {TILE_SIZE} from "@/client/constants.js";
import {CHUNK_SIZE, REGION_SIZE} from "@/common/constants.js";
import {chunkOrigin} from "@/common/util.js";
import {OVERWORLD_CELLS_PER_AXIS, BLEND_LEVELS} from "@/common/Terrain.js";

// Blend level -> weight of the other biome's color.
const BLEND_WEIGHT_PER_LEVEL = 1 / (2 * BLEND_LEVELS);

const CHUNK_PX = CHUNK_SIZE * TILE_SIZE;
const REGION_PX = REGION_SIZE * CHUNK_PX;
const REGION_HALF_PX = REGION_PX / 2;
const BYTES_PER_PIXEL = 4;
const COLOR_CHANNEL_MASK = 0xff;
const ALPHA_OPAQUE = 0xff;

// Shade variants per biome: SHADE_COUNT levels from darkest to lightest around the base color in the
// middle, each SHADE_STEP further from it; the shade noise (clustered around 0.5) is cut into bands
// SHADE_BAND wide, centered on 0.5, the outer levels taking the tails.
const SHADE_COUNT = 5;
const SHADE_BASE = Math.floor(SHADE_COUNT / 2);
const SHADE_STEP = 0.02;
const SHADE_BAND = 0.1;
const SHADE_NOISE_CENTER = 0.5;

/**
 * @param {number} noise the shade noise, in [0, 1]
 * @returns {number} the shade level it selects, in [0, SHADE_COUNT)
 */
function shadeFor(noise) {
    const level = Math.floor((noise - SHADE_NOISE_CENTER) / SHADE_BAND + SHADE_COUNT / 2);
    return Math.min(SHADE_COUNT - 1, Math.max(0, level));
}

/**
 * @param {number} channel 0-255
 * @param {number} shade level in [0, SHADE_COUNT)
 * @returns {number} the channel stepped toward black (below the base) or white (above it)
 */
function shadeChannel(channel, shade) {
    const offset = (shade - SHADE_BASE) * SHADE_STEP;
    if (offset < 0) {
        return Math.round(channel * (1 + offset));
    }
    return Math.round(channel + (COLOR_CHANNEL_MASK - channel) * offset);
}

/**
 * Biome id + shade level -> RGBA bytes, the lookup a terrain bake is painted through.
 */
export class TerrainPalette {

    /**
     * @param {Biome[]} biomes in biomeId order
     */
    constructor(biomes) {
        this._bytes = new Uint8Array(biomes.length * SHADE_COUNT * BYTES_PER_PIXEL);
        for (const [index, biome] of biomes.entries()) {
            for (let shade = 0; shade < SHADE_COUNT; shade++) {
                const at = (index * SHADE_COUNT + shade) * BYTES_PER_PIXEL;
                this._bytes[at] = shadeChannel((biome.color >> 16) & COLOR_CHANNEL_MASK, shade);
                this._bytes[at + 1] = shadeChannel((biome.color >> 8) & COLOR_CHANNEL_MASK, shade);
                this._bytes[at + 2] = shadeChannel(biome.color & COLOR_CHANNEL_MASK, shade);
                this._bytes[at + 3] = ALPHA_OPAQUE;
            }
        }
    }

    /**
     * @param {TerrainBake} bake
     * @param {function(number): number} shadeAt cell index -> shade variant
     * @returns {Uint8Array} RGBA per cell, same order
     */
    paint(bake, shadeAt) {
        const pixels = new Uint8Array(bake.biomes.length * BYTES_PER_PIXEL);
        this.paintInto(bake, pixels, 0, bake.biomes.length, shadeAt);
        return pixels;
    }

    /**
     * Paints each cell its shaded biome color, mixed toward its blend biome by its blend level.
     * @param {TerrainBake} bake
     * @param {Uint8Array} pixels RGBA per cell, same order
     * @param {number} fromCell
     * @param {number} toCell exclusive
     * @param {function(number): number} shadeAt cell index -> shade variant
     * @returns {void}
     */
    paintInto(bake, pixels, fromCell, toCell, shadeAt) {
        for (let cell = fromCell; cell < toCell; cell++) {
            const shade = shadeAt(cell);
            const from = (bake.biomes[cell] * SHADE_COUNT + shade) * BYTES_PER_PIXEL;
            const to = cell * BYTES_PER_PIXEL;
            let weight = 0;
            let other = from;
            if (bake.levels !== null && bake.levels[cell] > 0) {
                weight = bake.levels[cell] * BLEND_WEIGHT_PER_LEVEL;
                other = (bake.others[cell] * SHADE_COUNT + shade) * BYTES_PER_PIXEL;
            }
            pixels[to] = this._bytes[from] + (this._bytes[other] - this._bytes[from]) * weight;
            pixels[to + 1] = this._bytes[from + 1] + (this._bytes[other + 1] - this._bytes[from + 1]) * weight;
            pixels[to + 2] = this._bytes[from + 2] + (this._bytes[other + 2] - this._bytes[from + 2]) * weight;
            pixels[to + 3] = ALPHA_OPAQUE;
        }
    }
}

/**
 * @returns {number} the base shade, for bakes drawn flat
 */
function flatShade() {
    return SHADE_BASE;
}

/**
 * A square terrain bake painted into a texture (one texel per cell) and drawn as one nearest-sampled
 * sprite stretched over its world rect, so it batches with everything else.
 */
export class TerrainSprite extends Sprite {

    /**
     * @param {TerrainPalette} palette
     * @param {TerrainBake} bake row-major, cellsPerAxis² cells
     * @param {number} cellsPerAxis
     * @param {number} left world px
     * @param {number} top world px
     * @param {number} sidePx world px the bake spans
     * @param {function(number): number} shadeAt cell index -> shade variant
     */
    constructor(palette, bake, cellsPerAxis, left, top, sidePx, shadeAt) {
        const pixels = palette.paint(bake, shadeAt);
        const source = new BufferImageSource({
            resource: pixels,
            width: cellsPerAxis,
            height: cellsPerAxis,
            format: "rgba8unorm",
            scaleMode: "nearest",
            alphaMode: "premultiply-alpha-on-upload",
        });
        super(new Texture({source}));
        this.position.set(left, top);
        this.setSize(sidePx, sidePx);
        this._palette = palette;
        this._pixels = pixels;
        this._cellsPerAxis = cellsPerAxis;
        this._shadeAt = shadeAt;
    }

    /**
     * Repaints rows of the bake that changed since construction and re-uploads the texture.
     * @param {TerrainBake} bake the same bake the sprite was built from
     * @param {number} fromRow
     * @param {number} rowCount
     * @returns {void}
     */
    updateRows(bake, fromRow, rowCount) {
        const fromCell = fromRow * this._cellsPerAxis;
        const toCell = Math.min(fromCell + rowCount * this._cellsPerAxis, bake.biomes.length);
        this._palette.paintInto(bake, this._pixels, fromCell, toCell, this._shadeAt);
        this.texture.source.update();
    }

    /**
     * @param {TerrainPalette} palette
     * @param {number} chunk
     * @param {TerrainBake} bake the chunk's bake (Terrain.bakeChunk)
     * @param {Terrain} terrain for the shade noise
     * @returns {TerrainSprite} one texel per tile over the chunk, shaded by the shade channel
     */
    static forChunk(palette, chunk, bake, terrain) {
        const origin = chunkOrigin(chunk);
        const shadeAt = cell => shadeFor(terrain.shadeAt(origin.x + cell % CHUNK_SIZE, origin.y + Math.floor(cell / CHUNK_SIZE)));
        return new TerrainSprite(palette, bake, CHUNK_SIZE, origin.x * TILE_SIZE, origin.y * TILE_SIZE, CHUNK_PX, shadeAt);
    }

    /**
     * @param {TerrainPalette} palette
     * @param {TerrainBake} bake the region at overworld resolution (Terrain.overworldBake)
     * @returns {TerrainSprite} one texel per overworld cell over the region
     */
    static forOverworld(palette, bake) {
        return new TerrainSprite(palette, bake, OVERWORLD_CELLS_PER_AXIS, -REGION_HALF_PX, -REGION_HALF_PX, REGION_PX, flatShade);
    }

    /**
     * Frees the texture with the sprite.
     * @param {object|boolean} [options]
     * @returns {void}
     */
    destroy(options) {
        const texture = this.texture;
        super.destroy(options);
        texture.destroy(true);
    }
}
