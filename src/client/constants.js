import {CHUNK_SIZE} from "@/common/constants.js";

export const TILE_SIZE = 64;

// Font for all in-canvas (pixi) game text; loaded via the Lexend stylesheet in index.html.
export const GAME_FONT = "Lexend";

// Viewport scale below which the client switches to map mode: objects render as
// plain geometry instead of sprites and tile hover is disabled. Sits between the
// viewport's minScale (0.05) and maxScale (2).
export const MAP_MODE_SCALE_THRESHOLD = 0.25;

// Chunks that pan out of the viewport are kept subscribed for this long before being
// unsubscribed, so a quick pan back doesn't re-sync them; new chunks still subscribe at once.
export const CHUNK_UNSUBSCRIBE_DELAY_MS = 10_000;

export function snapToTile(n) {
    return Math.floor(n / TILE_SIZE) * TILE_SIZE;
}

export function snapToChunk(n) {
    return Math.floor(n / CHUNK_SIZE) * CHUNK_SIZE;
}

// Shared placement-preview ghost palette (used by every tool's ghost layer).
export const GHOST_TINT = 0xFFFFFF; // normal placement preview: untinted (natural sprite color)
export const GHOST_ALPHA = 0.9; // ghosts are always semi-transparent so the world shows through
export const GHOST_BLOCKED_TINT = 0xF23030; // placement blocked (red), matches PlacementFeedbackLayer
export const GHOST_BLOCKED_ALPHA = 0.8;

// Green marker drawn on the locked placement target tile in center-lock mode: an inset square
// with a semi-transparent fill and an opaque border.
export const TARGET_TILE_COLOR = 0x4CFF50;
export const TARGET_TILE_FILL_ALPHA = 0.22;
export const TARGET_TILE_BORDER_WIDTH = 3;

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

