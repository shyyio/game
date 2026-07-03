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

