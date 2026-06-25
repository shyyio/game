import {CHUNK_SIZE} from "@/common/constants.js";

export const TILE_SIZE = 64;

// Viewport scale below which the client switches to map mode: objects render as
// plain geometry instead of sprites and tile hover is disabled. Sits between the
// viewport's minScale (0.05) and maxScale (2).
export const MAP_MODE_SCALE_THRESHOLD = 0.25;

export function snapToTile(n) {
    return Math.floor(n / TILE_SIZE) * TILE_SIZE;
}

export function snapToChunk(n) {
    return Math.floor(n / CHUNK_SIZE) * CHUNK_SIZE;
}

// Saturated, distinct hues chosen to stay legible over belts on the white
// background; pale tints and bright yellows wash out, so they are avoided.
const DEBUG_COLORS = [
    0xe6194b, // red
    0xf58231, // orange
    0x3cb44b, // green
    0x4363d8, // blue
    0x911eb4, // purple
    0xf032e6, // magenta
    0x008080, // teal
    0x9a6324, // brown
    0x800000, // maroon
    0x808000, // olive
    0x000075, // navy
    0xff4500, // orange-red
    0xff1493, // deep pink
    0x1e90ff, // sky blue
    0x32cd32, // lime green
    0x8b008b, // dark magenta
    0xb8860b, // dark goldenrod
    0x2e8b57, // sea green
];

export const DEBUG_COLOR = (n) => DEBUG_COLORS[Number(n) % DEBUG_COLORS.length];

