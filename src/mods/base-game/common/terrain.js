import {NoiseChannel, Biome, NoiseRange} from "@spup/sdk";

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

// What map and overworld mode paint where the art is too small to read: each art's average color.
export const PALETTE_DIRT = 0x855D3C;
export const PALETTE_GRASS = 0x4C7E6F;

const TERRAIN_DIRT = "dirt.png";
const TERRAIN_GRASS = "grass2.png";
// Vegetation over bare ground: what grass wears where it meets dirt.
const TERRAIN_GRASS_EDGE = "grass1.png";

// Grass takes the humid half; dirt is unconditional and takes the rest.
export const BIOME_GRASS = new Biome({
    name: "grass",
    color: PALETTE_GRASS,
    texture: TERRAIN_GRASS,
    transition: TERRAIN_GRASS_EDGE,
    ranges: [new NoiseRange(HUMIDITY, 0.5, 1)],
    shadeStrength: 0,
});
export const BIOME_DIRT = new Biome({
    name: "dirt",
    color: PALETTE_DIRT,
    texture: TERRAIN_DIRT,
    shadeStrength: 0,
});

export const BIOMES = [BIOME_GRASS, BIOME_DIRT];
