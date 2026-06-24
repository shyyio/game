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

const DEBUG_COLORS = [
    0x3fd304,
    0xdf994d,
    0xa6d3d1,
    0xf3d04d,
    0xb2ff20,
    0x86354e,
    0x6a917e,
    0xe44623,
    0x974a49,
    0x341696,
    0x8a1325,
    0x27e9ad,
    0xe508b7,
    0x913003,
    0x72ba65,
    0x6452f6,
    0x9eaf64,
    0xdde951,
]

export const DEBUG_COLOR = (n) => DEBUG_COLORS[Number(n) % DEBUG_COLORS.length];

