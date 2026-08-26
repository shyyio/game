import {NoiseChannel, Biome, NoiseRange, TerrainDetail} from "@spup/sdk";

// ---- Noise channels ----
export const HUMIDITY = new NoiseChannel("humidity", 0.002, 2);
// Broader than humidity, so the two rarely draw the same edge.
export const TEMPERATURE = new NoiseChannel("temperature", 0.0015, 2);
export const NOISE_CHANNELS = [HUMIDITY, TEMPERATURE];

// ---- Palette: few flat colors, for the blocky look ----
export const PALETTE_GRASS = 0x7FA16A;
export const PALETTE_DRY_GRASS = 0x9FAA7A;
export const PALETTE_MARSH = 0x78977A;

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

// ---- Biomes, first match wins; grassland is the fallback ----
export const BIOME_SAVANNA = new Biome("savanna", PALETTE_DRY_GRASS, [new NoiseRange(HUMIDITY, 0, 0.42)], 0.5, details([
    new TerrainDetail(TUFT_1, 0.015, true, DETAIL_SCALE),
    new TerrainDetail(TUFT_2, 0.01, true, DETAIL_SCALE),
    new TerrainDetail(ROCK_1, 0.006, false, DETAIL_SCALE),
    new TerrainDetail(ROCK_2, 0.006, false, DETAIL_SCALE),
]));
export const BIOME_MARSH = new Biome("marsh", PALETTE_MARSH, [new NoiseRange(HUMIDITY, 0.64, 1)], 1, details([
    new TerrainDetail(SHRUB_1, 0.02, true, DETAIL_SCALE),
    new TerrainDetail(SHRUB_2, 0.015, true, DETAIL_SCALE),
    new TerrainDetail(TUFT_2, 0.01, true, DETAIL_SCALE),
]));
export const BIOME_GRASSLAND = new Biome("grassland", PALETTE_GRASS, [], 1, details([
    new TerrainDetail(TUFT_1, 0.02, true, DETAIL_SCALE),
    new TerrainDetail(TUFT_2, 0.015, true, DETAIL_SCALE),
    new TerrainDetail(SHRUB_1, 0.008, true, DETAIL_SCALE),
    new TerrainDetail(ROCK_1, 0.003, false, DETAIL_SCALE),
]));
export const BIOMES = [BIOME_SAVANNA, BIOME_MARSH, BIOME_GRASSLAND];
