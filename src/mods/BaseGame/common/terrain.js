import {NoiseChannel, Biome, NoiseRange, TerrainDetail} from "@spup/sdk";

// ---- Noise channels ----
export const HUMIDITY = new NoiseChannel("humidity", 0.002, 2);
// Broader than humidity, so the two rarely draw the same edge.
export const TEMPERATURE = new NoiseChannel("temperature", 0.0015, 2);
// Same scale as humidity; different seed keeps their edges apart.
export const DRAINAGE = new NoiseChannel("drainage", 0.002, 2);
// Plain simplex: band edges must stay smooth lines, octaves would fray them.
export const GEOLOGY = new NoiseChannel("geology", 0.0012, 1);
export const CORRUPTION = new NoiseChannel("corruption", 0.001, 1);
export const RICHNESS = new NoiseChannel("richness", 0.003, 2);
export const NOISE_CHANNELS = [HUMIDITY, TEMPERATURE, DRAINAGE, GEOLOGY, CORRUPTION, RICHNESS];

// ---- Palette: few flat colors, for the blocky look ----
export const PALETTE_GRASS = 0x7FA16A;
export const PALETTE_DRY_GRASS = 0x9FAA7A;
export const PALETTE_MARSH = 0x78977A;
export const PALETTE_LAKE = 0x3A5A6E;
export const PALETTE_LAKE_SHORE = 0x5E8574;
export const PALETTE_FOREST = 0x66875C;
export const PALETTE_SALT_FLAT = 0xBEB8A3;
// Corruption recolors: same value family, shifted to gray-purple.
export const PALETTE_CORRUPT_GRASS = 0x8B7E92;
export const PALETTE_CORRUPT_DRY_GRASS = 0x9C93A2;
export const PALETTE_CORRUPT_MARSH = 0x807B8E;
export const PALETTE_CORRUPT_LAKE = 0x44465F;
export const PALETTE_CORRUPT_LAKE_SHORE = 0x6D6A85;
export const PALETTE_CORRUPT_FOREST = 0x6F617F;
export const PALETTE_CORRUPT_SALT_FLAT = 0xB2A8B5;

// ---- Ground details (grayscale art takes the biome tint; rocks keep their own gray) ----
// Off until the art is final; the declarations stay so flipping this brings them back.
const DETAILS_ENABLED = false;
const DETAIL_SCALE = 1;
const TUFT_1 = "terrain/tuft-1";
const TUFT_2 = "terrain/tuft-2";
const SHRUB_1 = "terrain/shrub-1";
const SHRUB_2 = "terrain/shrub-2";
const ROCK_1 = "terrain/rock-1";
const ROCK_2 = "terrain/rock-2";

/**
 * @param {TerrainDetail[]} details
 * @returns {TerrainDetail[]} the details, or none while they are switched off
 */
function details(details) {
    if (!DETAILS_ENABLED) {
        return [];
    }
    return details;
}

// Water's edge is much tighter than land-to-land blending.
const LAKE_BLEND_WIDTH = 0.008;

// ---- Biomes, first match wins; grassland is the fallback ----
// The cascade carries weight: salt flat sits before savanna to steal its dry basins. The
// drainage gap between lake (< 0.35) and marsh (> 0.62) keeps lake shores varied.
export const BIOME_LAKE = new Biome("lake", PALETTE_LAKE, [
    new NoiseRange(HUMIDITY, 0.64, 1),
    new NoiseRange(DRAINAGE, 0, 0.35),
], 0.3, [], PALETTE_LAKE_SHORE, LAKE_BLEND_WIDTH);
export const BIOME_MARSH = new Biome("marsh", PALETTE_MARSH, [
    new NoiseRange(HUMIDITY, 0.64, 1),
    new NoiseRange(DRAINAGE, 0.62, 1),
], 1, details([
    new TerrainDetail(SHRUB_1, 0.02, true, DETAIL_SCALE),
    new TerrainDetail(SHRUB_2, 0.015, true, DETAIL_SCALE),
    new TerrainDetail(TUFT_2, 0.01, true, DETAIL_SCALE),
]));
export const BIOME_FOREST = new Biome("forest", PALETTE_FOREST, [
    new NoiseRange(HUMIDITY, 0.46, 1),
    new NoiseRange(TEMPERATURE, 0.32, 0.68),
], 1, details([
    new TerrainDetail(SHRUB_1, 0.025, true, DETAIL_SCALE),
    new TerrainDetail(SHRUB_2, 0.02, true, DETAIL_SCALE),
    new TerrainDetail(TUFT_1, 0.01, true, DETAIL_SCALE),
]));
export const BIOME_SALT_FLAT = new Biome("salt_flat", PALETTE_SALT_FLAT, [
    new NoiseRange(HUMIDITY, 0, 0.42),
    new NoiseRange(DRAINAGE, 0, 0.22),
], 0.4, details([
    new TerrainDetail(ROCK_1, 0.004, false, DETAIL_SCALE),
    new TerrainDetail(ROCK_2, 0.004, false, DETAIL_SCALE),
]));
export const BIOME_SAVANNA = new Biome("savanna", PALETTE_DRY_GRASS, [new NoiseRange(HUMIDITY, 0, 0.42)], 0.5, details([
    new TerrainDetail(TUFT_1, 0.015, true, DETAIL_SCALE),
    new TerrainDetail(TUFT_2, 0.01, true, DETAIL_SCALE),
    new TerrainDetail(ROCK_1, 0.006, false, DETAIL_SCALE),
    new TerrainDetail(ROCK_2, 0.006, false, DETAIL_SCALE),
]));
export const BIOME_GRASSLAND = new Biome("grassland", PALETTE_GRASS, [], 1, details([
    new TerrainDetail(TUFT_1, 0.02, true, DETAIL_SCALE),
    new TerrainDetail(TUFT_2, 0.015, true, DETAIL_SCALE),
    new TerrainDetail(SHRUB_1, 0.008, true, DETAIL_SCALE),
    new TerrainDetail(ROCK_1, 0.003, false, DETAIL_SCALE),
]));

// ---- Corrupted variants: the corruption channel's top band recolors every biome ----
// A corrupted biome keeps its base's rules and role (a corrupted lake is still water); it sits
// before its base in the cascade so the corruption range decides between the two.
const CORRUPTION_MIN = 0.85;

/**
 * @param {Biome} base
 * @param {number} color
 * @param {number|null} [blendColor]
 * @returns {Biome} the base's rules plus the corruption band, recolored
 */
function corrupted(base, color, blendColor = null) {
    const ranges = [new NoiseRange(CORRUPTION, CORRUPTION_MIN, 1), ...base.ranges];
    return new Biome(`corrupted_${base.name}`, color, ranges, base.shadeStrength, base.details, blendColor, base.blendWidth);
}

export const BIOME_CORRUPT_LAKE = corrupted(BIOME_LAKE, PALETTE_CORRUPT_LAKE, PALETTE_CORRUPT_LAKE_SHORE);
export const BIOME_CORRUPT_MARSH = corrupted(BIOME_MARSH, PALETTE_CORRUPT_MARSH);
export const BIOME_CORRUPT_FOREST = corrupted(BIOME_FOREST, PALETTE_CORRUPT_FOREST);
export const BIOME_CORRUPT_SALT_FLAT = corrupted(BIOME_SALT_FLAT, PALETTE_CORRUPT_SALT_FLAT);
export const BIOME_CORRUPT_SAVANNA = corrupted(BIOME_SAVANNA, PALETTE_CORRUPT_DRY_GRASS);
export const BIOME_CORRUPT_GRASSLAND = corrupted(BIOME_GRASSLAND, PALETTE_CORRUPT_GRASS);

export const BIOMES = [
    BIOME_CORRUPT_LAKE, BIOME_CORRUPT_MARSH, BIOME_CORRUPT_FOREST, BIOME_CORRUPT_SALT_FLAT,
    BIOME_CORRUPT_SAVANNA, BIOME_CORRUPT_GRASSLAND,
    BIOME_LAKE, BIOME_MARSH, BIOME_FOREST, BIOME_SALT_FLAT, BIOME_SAVANNA, BIOME_GRASSLAND,
];
