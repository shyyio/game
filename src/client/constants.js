import {CHUNK_SIZE, REGION_SIZE} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";

export const TILE_SIZE = 64;

// Font for all in-canvas (pixi) game text; loaded via the Lexend stylesheet in index.html.
export const GAME_FONT = "Lexend";

// The client's zoom-driven view mode: sprites, map geometry, or the baked overworld.
export const ViewMode = {WORLD: 0, MAP: 1, OVERWORLD: 2};

// Viewport scale below which the client switches to map mode: objects render as
// plain geometry instead of sprites and tile hover is disabled.
export const MAP_MODE_SCALE_THRESHOLD = 0.25;

// Viewport scale below which the client switches to overworld mode: chunk subscriptions
// drop and the baked overworld snapshots render instead.
export const OVERWORLD_SCALE_THRESHOLD = 0.03;

// The zoom floor: the whole region fits a ~1024px screen.
export const MIN_VIEWPORT_SCALE = 1024 / (REGION_SIZE * CHUNK_SIZE * TILE_SIZE);

// Screen-pixel gap between bottom-anchored HUD elements and the screen bottom, clearing the toolbar.
export const HUD_BOTTOM_OFFSET = 160;

// Key that leaves any input mode, shown as the hint on the status bar's exit buttons.
export const EXIT_HOTKEY = "q";

// Key that fires the bottom action bar's Confirm.
export const CONFIRM_HOTKEY = "Enter";

// Where the chunk-picking modes park the view: map mode's far edge, just shy of overworld.
export const CHUNK_PICK_ZOOM_SCALE = OVERWORLD_SCALE_THRESHOLD * 1.1;

// A cached overworld chunk older than this refetches when it is next visible.
export const OVERWORLD_CHUNK_TTL_MS = 30_000;

// At most one overworld request per this window while panning.
export const OVERWORLD_REFRESH_THROTTLE_MS = 500;

// At most one friends-panel rebuild (full DOM-input teardown/recreate included) per this window
// while panning/zooming with the panel open.
export const FRIENDS_PANEL_REFRESH_THROTTLE_MS = 500;

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
    return chunksOver(left, top, right, bottom);
}

/**
 * The chunk ids in a snapped tile rect, both ends inclusive.
 * @param {number} left snapped tile x
 * @param {number} top snapped tile y
 * @param {number} right snapped tile x
 * @param {number} bottom snapped tile y
 * @returns {Set<number>}
 */
function chunksOver(left, top, right, bottom) {
    const chunks = new Set();
    for (let x = left; x <= right; x += CHUNK_SIZE) {
        for (let y = top; y <= bottom; y += CHUNK_SIZE) {
            chunks.add(chunkId(x, y));
        }
    }
    return chunks;
}

/**
 * The viewport's covered chunks, rebuilt only when the covered rect moves. Every frame asks for the
 * set, so holding one instance saves an allocation and lets layers reconcile on identity.
 */
export class ViewportChunkWindow {

    constructor() {
        this._left = null;
        this._top = null;
        this._right = null;
        this._bottom = null;
        this._chunks = new Set();
    }

    /**
     * @param {ClientViewport} viewport
     * @returns {Set<number>} the same instance until the rect moves
     */
    chunks(viewport) {
        const left = snapToChunk(viewport.left / TILE_SIZE) - CHUNK_SIZE;
        const top = snapToChunk(viewport.top / TILE_SIZE) - CHUNK_SIZE;
        const right = snapToChunk(viewport.right / TILE_SIZE) + CHUNK_SIZE;
        const bottom = snapToChunk(viewport.bottom / TILE_SIZE) + CHUNK_SIZE;
        if (left === this._left && top === this._top && right === this._right && bottom === this._bottom) {
            return this._chunks;
        }
        this._left = left;
        this._top = top;
        this._right = right;
        this._bottom = bottom;
        // A fresh Set, never a mutation: layers hold the instance they last reconciled against.
        this._chunks = chunksOver(left, top, right, bottom);
        return this._chunks;
    }
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

