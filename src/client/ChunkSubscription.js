import {SetViewportMessage, OverworldRequestMessage} from "@/common/CoreMessages.js";
import {
    TILE_SIZE,
    snapToChunk,
    ViewportChunkWindow,
    OVERWORLD_CHUNK_TTL_MS,
    OVERWORLD_REFRESH_THROTTLE_MS,
} from "@/client/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {chunkId, REGION_HALF} from "@/common/util.js";
import {OverworldRect} from "@/client/state/OverworldState.js";

// Handed to the layer tick in overworld mode, where no chunks are mounted: building the real
// visible-chunk set at overworld scale would enumerate thousands of chunks per frame.
const NO_VISIBLE_CHUNKS = new Set();

/**
 * The chunk set the viewport covers: which chunks are subscribed on the server, and the overworld
 * snapshot feed that replaces those subscriptions while zoomed out past the map band.
 */
export class ChunkSubscription {

    /**
     * @param {ClientViewport} viewport
     * @param {ClientCache} cache
     * @param {AbstractSession} session
     * @param {StatusMessageLayer} statusLayer
     */
    constructor(viewport, cache, session, statusLayer) {
        this._viewport = viewport;
        this._cache = cache;
        this._session = session;
        this._statusLayer = statusLayer;
        // Chunks currently subscribed on the server: the visible chunks.
        this._requestedChunks = new Set();
        this._lastVisibleKey = null;
        // Rebuilds the visible-chunk set only when the covered rect moves.
        this._chunkWindow = new ViewportChunkWindow();
        this._lastOverworldRefreshMs = 0;
        // Whether the overworld snapshot feed has replaced the chunk subscriptions.
        this._overworld = false;
    }

    /**
     * The chunks the culled draw layers should mount this frame; empty in overworld mode.
     * @returns {Set<number>}
     */
    visibleChunks() {
        if (this._overworld) {
            return NO_VISIBLE_CHUNKS;
        }
        return this._chunkWindow.chunks(this._viewport);
    }

    /**
     * Routes viewport movement to the mode's data feed: chunk subscriptions, or overworld
     * snapshot refreshes when zoomed past the map band.
     * @returns {void}
     */
    viewportMoved() {
        if (this._overworld) {
            this._refreshOverworld(false);
        } else {
            this._updateViewportChunks();
        }
    }

    /**
     * Drops every chunk subscription at once (the teardown is invisible behind the overworld
     * layer) and requests the first snapshot.
     * @returns {void}
     */
    enterOverworld() {
        this._overworld = true;
        this._requestedChunks.clear();
        this._sendViewport(false);
        this._lastVisibleKey = null;
        this._refreshOverworld(true);
    }

    /**
     * Resubscribes the visible chunks through the normal viewport path.
     * @returns {void}
     */
    leaveOverworld() {
        this._overworld = false;
        this._lastVisibleKey = null;
        this._updateViewportChunks();
    }

    /**
     * Re-requests the current viewport's data after a reconnect: the server has no memory of this
     * connection's old subscriptions.
     * @returns {void}
     */
    resync() {
        this._lastVisibleKey = null;
        if (this._overworld) {
            this._lastOverworldRefreshMs = 0;
            this._refreshOverworld(true);
        } else {
            this._requestedChunks.clear();
            this._updateViewportChunks();
        }
    }

    /**
     * Requests the visible overworld rect when any of its chunks is missing or stale, then
     * evicts stale entries outside it. Throttled while panning; `force` bypasses.
     * @private
     * @param {boolean} force
     */
    _refreshOverworld(force) {
        const now = Date.now();
        if (!force && now - this._lastOverworldRefreshMs < OVERWORLD_REFRESH_THROTTLE_MS) {
            return;
        }
        this._lastOverworldRefreshMs = now;
        const rect = this._visibleOverworldRect();
        if (rect === null) {
            return;
        }
        if (this._cache.view("overworld").needsFetch(rect, now, OVERWORLD_CHUNK_TTL_MS)) {
            this._session.sendMessage(
                new OverworldRequestMessage(rect.chunkX, rect.chunkY, rect.chunkWidth, rect.chunkHeight),
            );
        }
        this._cache.writer("overworld").evictOutside(rect, now, OVERWORLD_CHUNK_TTL_MS);
    }

    /**
     * The viewport's chunk rect clamped to the region, or null when fully outside it.
     * @private
     * @returns {OverworldRect|null}
     */
    _visibleOverworldRect() {
        const chunkPx = CHUNK_SIZE * TILE_SIZE;
        const left = Math.max(Math.floor(this._viewport.left / chunkPx), -REGION_HALF);
        const top = Math.max(Math.floor(this._viewport.top / chunkPx), -REGION_HALF);
        const right = Math.min(Math.floor(this._viewport.right / chunkPx), REGION_HALF - 1);
        const bottom = Math.min(Math.floor(this._viewport.bottom / chunkPx), REGION_HALF - 1);
        if (right < left || bottom < top) {
            return null;
        }
        return new OverworldRect(left, top, right - left + 1, bottom - top + 1);
    }

    /**
     * @private
     * @param {number} [marginChunks] - extra chunk rings beyond the viewport
     * @returns {number[]}
     */
    _chunksInView(marginChunks = 0) {
        const margin = marginChunks * CHUNK_SIZE;
        const x1 = this._viewport.left / TILE_SIZE - margin;
        const y1 = this._viewport.top / TILE_SIZE - margin;
        const x2 = this._viewport.right / TILE_SIZE + margin;
        const y2 = this._viewport.bottom / TILE_SIZE + margin;

        const chunks = [];
        for (let x = snapToChunk(x1) - CHUNK_SIZE; x <= snapToChunk(x2); x += CHUNK_SIZE) {
            for (let y = snapToChunk(y1) - CHUNK_SIZE; y <= snapToChunk(y2); y += CHUNK_SIZE) {
                chunks.push(chunkId(x, y));
            }
        }
        return chunks;
    }

    /**
     * @private
     * @returns {void}
     */
    _updateViewportChunks() {
        if (this._overworld) {
            // No chunk subscriptions in overworld; enumerating the visible chunks at overworld
            // scale would also walk thousands of ids.
            return;
        }
        const visible = this._chunksInView();
        const visibleKey = visible.slice().sort().join(";");
        if (visibleKey === this._lastVisibleKey) {
            return;
        }
        this._lastVisibleKey = visibleKey;

        // Unsubscribe only past a one-chunk hysteresis ring, so a pan grazing a boundary
        // never re-syncs the chunk.
        let changed = false;
        const retained = new Set(this._chunksInView(1));
        for (const chunk of [...this._requestedChunks]) {
            if (!retained.has(chunk)) {
                this._requestedChunks.delete(chunk);
                changed = true;
            }
        }
        let added = false;
        for (const chunk of visible) {
            if (!this._requestedChunks.has(chunk)) {
                this._requestedChunks.add(chunk);
                added = true;
                changed = true;
            }
        }
        if (changed) {
            this._sendViewport(added);
        }
    }

    /**
     * Sends the current requested-chunk set to the server.
     * @private
     * @param {boolean} loading - whether to drive the loading status (only when subscribing)
     */
    _sendViewport(loading) {
        const chunks = [...this._requestedChunks];
        if (loading) {
            // Track the request before sending: single-player replies with the
            // ChunkSubscribeEvents synchronously, so the layer must already be counting.
            this._statusLayer.beginChunkLoad(chunks);
        }
        this._session.sendMessage(new SetViewportMessage(chunks));
    }

}
