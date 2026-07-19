import {CHUNK_SIZE} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";

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

/**
 * The chunks `viewport` covers, with a one-chunk margin on every side so a chunk's sprites are
 * already mounted when it scrolls in. Layers cull their children against this: pixi walks every
 * child of a container each frame, so off-screen sprites cost even while invisible.
 * @param {ClientViewport} viewport
 * @returns {Set<number>}
 */
export function viewportChunks(viewport) {
    const left = snapToChunk(viewport.left / TILE_SIZE) - CHUNK_SIZE;
    const top = snapToChunk(viewport.top / TILE_SIZE) - CHUNK_SIZE;
    const right = snapToChunk(viewport.right / TILE_SIZE) + CHUNK_SIZE;
    const bottom = snapToChunk(viewport.bottom / TILE_SIZE) + CHUNK_SIZE;

    const chunks = new Set();
    for (let x = left; x <= right; x += CHUNK_SIZE) {
        for (let y = top; y <= bottom; y += CHUNK_SIZE) {
            chunks.add(chunkId(x, y));
        }
    }
    return chunks;
}

/**
 * @param {Set<number>} a
 * @param {Set<number>} b
 * @returns {boolean} whether both sets hold the same chunk ids
 */
export function sameChunks(a, b) {
    if (a.size !== b.size) {
        return false;
    }
    for (const chunk of a) {
        if (!b.has(chunk)) {
            return false;
        }
    }
    return true;
}

