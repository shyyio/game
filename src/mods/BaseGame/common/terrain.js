import {NoiseChannel, Biome, NoiseRange} from "@spup/sdk";

// ---- Noise channels ----
export const HUMIDITY = new NoiseChannel("humidity", 0.002, 2);
export const NOISE_CHANNELS = [HUMIDITY];

// ---- Palette: few flat colors, for the blocky look ----
export const PALETTE_GRASS = 0x7FA16A;
export const PALETTE_DRY_GRASS = 0x9FAA7A;
export const PALETTE_MARSH = 0x78977A;

// ---- Biomes, first match wins; grassland is the fallback ----
export const BIOME_SAVANNA = new Biome("savanna", PALETTE_DRY_GRASS, [new NoiseRange(HUMIDITY, 0, 0.42)], 0.5);
export const BIOME_MARSH = new Biome("marsh", PALETTE_MARSH, [new NoiseRange(HUMIDITY, 0.64, 1)], 0.8);
export const BIOME_GRASSLAND = new Biome("grassland", PALETTE_GRASS, [], 0.5);
export const BIOMES = [BIOME_SAVANNA, BIOME_MARSH, BIOME_GRASSLAND];
