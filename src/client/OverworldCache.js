import {chunkOrdinal} from "@/common/util.js";

const EMPTY_RUNS = [];

/**
 * A rect of chunks in chunk coordinates, the unit overworld snapshots are requested in.
 */
export class OverworldRect {

    /**
     * @param {number} chunkX
     * @param {number} chunkY
     * @param {number} chunkWidth
     * @param {number} chunkHeight
     */
    constructor(chunkX, chunkY, chunkWidth, chunkHeight) {
        this.chunkX = chunkX;
        this.chunkY = chunkY;
        this.chunkWidth = chunkWidth;
        this.chunkHeight = chunkHeight;
    }

    /**
     * The ordinals of every chunk in the rect.
     * @returns {IterableIterator<number>}
     */
    * ordinals() {
        for (let cy = this.chunkY; cy < this.chunkY + this.chunkHeight; cy += 1) {
            for (let cx = this.chunkX; cx < this.chunkX + this.chunkWidth; cx += 1) {
                yield chunkOrdinal(cx, cy);
            }
        }
    }
}

/**
 * One received chunk's bake: row-constrained tile runs plus receipt time for the TTL.
 */
export class OverworldChunkEntry {

    /**
     * @param {number} chunk
     * @param {number[]} runStarts
     * @param {number[]} runLengths
     * @param {number[]} runTypeIds
     * @param {number} receivedAt
     */
    constructor(chunk, runStarts, runLengths, runTypeIds, receivedAt) {
        this.chunk = chunk;
        this.runStarts = runStarts;
        this.runLengths = runLengths;
        this.runTypeIds = runTypeIds;
        this.receivedAt = receivedAt;
    }
}

/**
 * The client's store of received overworld chunk bakes. A snapshot stamps every chunk of its rect
 * (unlisted chunks as cached emptiness), so staleness is per chunk, not per request.
 */
export class OverworldCache {

    constructor() {
        // Chunk ordinal -> OverworldChunkEntry.
        this._entries = new Map();
        this._updateListeners = [];
    }

    /**
     * Registers a listener called with the chunk ordinals a write or eviction touched.
     * @param {function(number[]): void} listener
     * @returns {void}
     */
    onUpdate(listener) {
        this._updateListeners.push(listener);
    }

    /**
     * The entry for a chunk ordinal, or undefined.
     * @param {number} chunk
     * @returns {OverworldChunkEntry|undefined}
     */
    entry(chunk) {
        return this._entries.get(chunk);
    }

    /**
     * @returns {IterableIterator<OverworldChunkEntry>}
     */
    entries() {
        return this._entries.values();
    }

    /**
     * Stores a snapshot's runs, stamping every chunk of its rect as fresh.
     * @param {OverworldSnapshotEvent} event
     * @param {number} nowMs
     * @returns {void}
     */
    write(event, nowMs) {
        const runsByChunk = new Map();
        let offset = 0;
        for (let i = 0; i < event.chunks.length; i += 1) {
            const count = event.runCounts[i];
            runsByChunk.set(event.chunks[i], new OverworldChunkEntry(
                event.chunks[i],
                event.runStarts.slice(offset, offset + count),
                event.runLengths.slice(offset, offset + count),
                event.runTypeIds.slice(offset, offset + count),
                nowMs,
            ));
            offset += count;
        }
        const rect = new OverworldRect(event.chunkX, event.chunkY, event.chunkWidth, event.chunkHeight);
        const touched = [];
        for (const chunk of rect.ordinals()) {
            let entry = runsByChunk.get(chunk);
            if (entry === undefined) {
                entry = new OverworldChunkEntry(chunk, EMPTY_RUNS, EMPTY_RUNS, EMPTY_RUNS, nowMs);
            }
            this._entries.set(chunk, entry);
            touched.push(chunk);
        }
        this._notify(touched);
    }

    /**
     * Whether any chunk of the rect is missing or older than the TTL.
     * @param {OverworldRect} rect
     * @param {number} nowMs
     * @param {number} ttlMs
     * @returns {boolean}
     */
    needsFetch(rect, nowMs, ttlMs) {
        for (const chunk of rect.ordinals()) {
            const entry = this._entries.get(chunk);
            if (entry === undefined || nowMs - entry.receivedAt > ttlMs) {
                return true;
            }
        }
        return false;
    }

    /**
     * Drops stale entries outside the rect, bounding memory at roughly the last-viewed area.
     * @param {OverworldRect} rect
     * @param {number} nowMs
     * @param {number} ttlMs
     * @returns {void}
     */
    evictOutside(rect, nowMs, ttlMs) {
        const kept = new Set(rect.ordinals());
        const removed = [];
        for (const [chunk, entry] of this._entries) {
            if (!kept.has(chunk) && nowMs - entry.receivedAt > ttlMs) {
                this._entries.delete(chunk);
                removed.push(chunk);
            }
        }
        if (removed.length > 0) {
            this._notify(removed);
        }
    }

    /**
     * @private
     * @param {number[]} chunks
     * @returns {void}
     */
    _notify(chunks) {
        for (const listener of this._updateListeners) {
            listener(chunks);
        }
    }
}
