import {BufferImageSource, Sprite, Texture} from "pixi.js";
import {TILE_SIZE} from "@/client/constants.js";
import {CHUNK_SIZE, REGION_SIZE} from "@/common/constants.js";
import {chunkOrigin} from "@/common/util.js";
import {BLEND_LEVELS, BLEND_WEIGHT_SCALE, OVERWORLD_CELLS_PER_AXIS} from "@/common/Terrain.js";
import {ditherThreshold} from "@/client/layers/DitherPatterns.js";

// A blend tops out at a 50/50 mix on the biome line, so one baked unit is this share of the other
// biome, whatever the level count.
const WEIGHT_PER_BAKED_UNIT = 0.5 / BLEND_WEIGHT_SCALE;

// Comparison switch: how many steps the blend is banded into. At 0 no cell mixes a new color, so a
// dithered edge stipples the two biomes' flat colors and an undithered one steps hard.
let blendLevels = BLEND_LEVELS;
let weightPerLevel = 1 / (2 * BLEND_LEVELS);
let levelsPerBakedWeight = BLEND_LEVELS / BLEND_WEIGHT_SCALE;

/**
 * @param {number} levels bands between a biome and its blend biome; 0 mixes nothing
 * @returns {number} the level count now in force
 * @throws {RangeError} unless levels is an integer in [0, BLEND_WEIGHT_SCALE]
 */
export function setBlendLevels(levels) {
    if (!Number.isInteger(levels) || levels < 0 || levels > BLEND_WEIGHT_SCALE) {
        throw new RangeError(`Blend levels must be an integer in [0, ${BLEND_WEIGHT_SCALE}], got ${levels}`);
    }
    blendLevels = levels;
    // No levels means no mixing at all; leaving the divisor at zero would seed a NaN weight.
    if (levels > 0) {
        weightPerLevel = 1 / (2 * levels);
        levelsPerBakedWeight = levels / BLEND_WEIGHT_SCALE;
    }
    return blendLevels;
}

/**
 * @returns {number}
 */
export function blendLevelCount() {
    return blendLevels;
}

const CHUNK_PX = CHUNK_SIZE * TILE_SIZE;
const REGION_PX = REGION_SIZE * CHUNK_PX;
const REGION_HALF_PX = REGION_PX / 2;
// Ground color while the terrain is off.
const BLANK_TINT = 0xffffff;
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

// Retuned by the terrain tuner; the step is baked into the palette, so a change needs a rebuild.
let activeShadeStep = SHADE_STEP;
let activeShadeBand = SHADE_BAND;

/**
 * @param {number} step how far each shade level moves from the biome's base color
 * @returns {number} the step now in force
 * @throws {RangeError} unless step is >= 0
 */
export function setShadeStep(step) {
    if (!(step >= 0)) {
        throw new RangeError(`Shade step must be >= 0, got ${step}`);
    }
    activeShadeStep = step;
    return activeShadeStep;
}

/**
 * @returns {number}
 */
export function shadeStep() {
    return activeShadeStep;
}

/**
 * @param {number} band how much shade noise one level spans; wider = fewer tiles off the base
 * @returns {number} the band now in force
 * @throws {RangeError} unless band is > 0
 */
export function setShadeBand(band) {
    if (!(band > 0)) {
        throw new RangeError(`Shade band must be > 0, got ${band}`);
    }
    activeShadeBand = band;
    return activeShadeBand;
}

/**
 * @returns {number}
 */
export function shadeBand() {
    return activeShadeBand;
}

/**
 * @param {number} noise the shade noise, in [0, 1]
 * @returns {number} the shade level it selects, in [0, SHADE_COUNT)
 */
function shadeFor(noise) {
    const level = Math.floor((noise - SHADE_NOISE_CENTER) / activeShadeBand + SHADE_COUNT / 2);
    return Math.min(SHADE_COUNT - 1, Math.max(0, level));
}

/**
 * @param {number} channel 0-255
 * @param {number} shade level in [0, SHADE_COUNT)
 * @param {number} strength the biome's multiplier on the step
 * @returns {number} the channel stepped toward black (below the base) or white (above it)
 */
function shadeChannel(channel, shade, strength) {
    const offset = (shade - SHADE_BASE) * activeShadeStep * strength;
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
                this._bytes[at] = shadeChannel((biome.color >> 16) & COLOR_CHANNEL_MASK, shade, biome.shadeStrength);
                this._bytes[at + 1] = shadeChannel((biome.color >> 8) & COLOR_CHANNEL_MASK, shade, biome.shadeStrength);
                this._bytes[at + 2] = shadeChannel(biome.color & COLOR_CHANNEL_MASK, shade, biome.shadeStrength);
                this._bytes[at + 3] = ALPHA_OPAQUE;
            }
        }
    }

    /**
     * @param {TerrainBake} bake
     * @param {function(number): number} shadeAt cell index -> shade variant
     * @param {function(number): number} ditherAt cell index -> dither threshold
     * @returns {Uint8Array} RGBA per cell, same order
     */
    paint(bake, shadeAt, ditherAt) {
        const pixels = new Uint8Array(bake.biomes.length * BYTES_PER_PIXEL);
        this.paintInto(bake, pixels, 0, bake.biomes.length, shadeAt, ditherAt);
        return pixels;
    }

    /**
     * Paints each cell its shaded biome color, mixed toward its blend biome by its blend level, the
     * level dithered so neighboring cells straddle the band edge rather than stepping together.
     * With blending off the dither instead decides the cell's biome outright, stippling the two.
     * @param {TerrainBake} bake
     * @param {Uint8Array} pixels RGBA per cell, same order
     * @param {number} fromCell
     * @param {number} toCell exclusive
     * @param {function(number): number} shadeAt cell index -> shade variant
     * @param {function(number): number} ditherAt cell index -> dither threshold
     * @returns {void}
     */
    paintInto(bake, pixels, fromCell, toCell, shadeAt, ditherAt) {
        for (let cell = fromCell; cell < toCell; cell++) {
            const shade = shadeAt(cell);
            let biome = bake.biomes[cell];
            let weight = 0;
            if (bake.weights !== null && bake.weights[cell] > 0) {
                if (blendLevels > 0) {
                    weight = this._blendWeight(bake.weights[cell], ditherAt(cell));
                } else if (bake.weights[cell] * WEIGHT_PER_BAKED_UNIT > ditherAt(cell)) {
                    // Nothing to mix, so the cell takes the other biome whole instead.
                    biome = bake.others[cell];
                }
            }
            const from = (biome * SHADE_COUNT + shade) * BYTES_PER_PIXEL;
            const to = cell * BYTES_PER_PIXEL;
            let other = from;
            if (weight > 0) {
                other = (bake.others[cell] * SHADE_COUNT + shade) * BYTES_PER_PIXEL;
            }
            pixels[to] = this._bytes[from] + (this._bytes[other] - this._bytes[from]) * weight;
            pixels[to + 1] = this._bytes[from + 1] + (this._bytes[other + 1] - this._bytes[from + 1]) * weight;
            pixels[to + 2] = this._bytes[from + 2] + (this._bytes[other + 2] - this._bytes[from + 2]) * weight;
            pixels[to + 3] = ALPHA_OPAQUE;
        }
    }

    /**
     * The baked weight banded into the active level count, rounded up when the part-level beats the
     * cell's dither threshold.
     * @private
     * @param {number} baked the cell's baked blend weight
     * @param {number} threshold the cell's dither threshold
     * @returns {number} the other biome's share of the cell's color
     */
    _blendWeight(baked, threshold) {
        const scaled = baked * levelsPerBakedWeight;
        let level = Math.floor(scaled);
        if (scaled - level > threshold) {
            level += 1;
        }
        return level * weightPerLevel;
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
     * @param {TerrainBake} bake row-major, square
     * @param {number} left world px
     * @param {number} top world px
     * @param {number} sidePx world px the bake spans
     * @param {function(number): number} shadeAt cell index -> shade variant
     * @param {function(number): number} ditherAt cell index -> dither threshold
     */
    constructor(palette, bake, left, top, sidePx, shadeAt, ditherAt) {
        const pixels = palette.paint(bake, shadeAt, ditherAt);
        const source = new BufferImageSource({
            resource: pixels,
            width: bake.cellsPerAxis,
            height: bake.cellsPerAxis,
            format: "rgba8unorm",
            scaleMode: "nearest",
            alphaMode: "premultiply-alpha-on-upload",
        });
        super(new Texture({source}));
        this.position.set(left, top);
        this.setSize(sidePx, sidePx);
        this._palette = palette;
        this._pixels = pixels;
        this._cellsPerAxis = bake.cellsPerAxis;
        this._shadeAt = shadeAt;
        this._ditherAt = ditherAt;
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
        this._palette.paintInto(bake, this._pixels, fromCell, toCell, this._shadeAt, this._ditherAt);
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
        // World tile, not chunk-local, so a pattern without a 64-tile period still tiles seamlessly.
        const ditherAt = cell => ditherThreshold(origin.x + cell % CHUNK_SIZE, origin.y + Math.floor(cell / CHUNK_SIZE));
        return new TerrainSprite(palette, bake, origin.x * TILE_SIZE, origin.y * TILE_SIZE, CHUNK_PX, shadeAt, ditherAt);
    }

    /**
     * @param {TerrainPalette} palette
     * @param {TerrainBake} bake the region at overworld resolution (Terrain.overworldBake)
     * @returns {TerrainSprite} one texel per overworld cell over the region
     */
    static forOverworld(palette, bake) {
        const ditherAt = cell => ditherThreshold(cell % OVERWORLD_CELLS_PER_AXIS, Math.floor(cell / OVERWORLD_CELLS_PER_AXIS));
        return new TerrainSprite(palette, bake, -REGION_HALF_PX, -REGION_HALF_PX, REGION_PX, flatShade, ditherAt);
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

/**
 * @param {number} chunk
 * @returns {Sprite} flat white ground over the chunk, for when the terrain is off
 */
export function blankChunkSprite(chunk) {
    const origin = chunkOrigin(chunk);
    return blankSprite(origin.x * TILE_SIZE, origin.y * TILE_SIZE, CHUNK_PX);
}

/**
 * @returns {Sprite} flat white ground over the region, for when the terrain is off
 */
export function blankOverworldSprite() {
    return blankSprite(-REGION_HALF_PX, -REGION_HALF_PX, REGION_PX);
}

/**
 * @param {number} left world px
 * @param {number} top world px
 * @param {number} sidePx world px the sprite spans
 * @returns {Sprite}
 */
function blankSprite(left, top, sidePx) {
    const sprite = new Sprite(Texture.WHITE);
    sprite.tint = BLANK_TINT;
    sprite.position.set(left, top);
    sprite.setSize(sidePx, sidePx);
    return sprite;
}
