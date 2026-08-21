import {NoiseChannel, Biome, NoiseRange} from "@spup/sdk";

// ---- Noise channels ----
export const TEMPERATURE = new NoiseChannel("temperature", 0.0015);
export const HUMIDITY = new NoiseChannel("humidity", 0.002, 2);
export const NOISE_CHANNELS = [TEMPERATURE, HUMIDITY];

// ---- Palette: few flat colors, for the blocky look ----
export const PALETTE_GRASS = 0x7BB05B;
export const PALETTE_DRY_GRASS = 0xB9B46B;
export const PALETTE_SAND = 0xD9C28A;
export const PALETTE_MARSH = 0x6FA073;

// ---- Biomes, first match wins; grassland is the fallback ----
export const BIOME_DESERT = new Biome("desert", PALETTE_SAND, [
    new NoiseRange(TEMPERATURE, 0.6, 1),
    new NoiseRange(HUMIDITY, 0, 0.42),
]);
export const BIOME_SAVANNA = new Biome("savanna", PALETTE_DRY_GRASS, [new NoiseRange(HUMIDITY, 0, 0.42)]);
export const BIOME_MARSH = new Biome("marsh", PALETTE_MARSH, [new NoiseRange(HUMIDITY, 0.64, 1)]);
export const BIOME_GRASSLAND = new Biome("grassland", PALETTE_GRASS);
export const BIOMES = [BIOME_DESERT, BIOME_SAVANNA, BIOME_MARSH, BIOME_GRASSLAND];
