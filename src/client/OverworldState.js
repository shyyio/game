import {chunkOrdinal} from "@/common/util.js";
import {OverworldSnapshotEvent} from "@/common/OverworldEvents.js";
import {AbstractCacheWriter, AbstractCacheView, schemaMap} from "@/client/ClientCache.js";

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

export const OVERWORLD_SCHEMA = {
    byChunk: schemaMap(),
};

/**
 * @typedef {object} OverworldChunkState one received chunk's bake: row-constrained tile runs
 *     plus receipt time for the TTL
 * @property {number} chunk
 * @property {number[]} runStarts
 * @property {number[]} runLengths
 * @property {number[]} runTypeIds
 * @property {number} receivedAt
 */

/**
 * Writes received overworld bakes. A snapshot stamps every chunk of its rect (unlisted chunks as
 * cached emptiness), so staleness is per chunk, not per request.
 */
export class OverworldWriter extends AbstractCacheWriter {

    /**
     * Applies an overworld snapshot event.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof OverworldSnapshotEvent) {
            this.write(event, Date.now());
        }
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
            runsByChunk.set(event.chunks[i], {
                chunk: event.chunks[i],
                runStarts: event.runStarts.slice(offset, offset + count),
                runLengths: event.runLengths.slice(offset, offset + count),
                runTypeIds: event.runTypeIds.slice(offset, offset + count),
                receivedAt: nowMs,
            });
            offset += count;
        }
        const rect = new OverworldRect(event.chunkX, event.chunkY, event.chunkWidth, event.chunkHeight);
        for (const chunk of rect.ordinals()) {
            let entry = runsByChunk.get(chunk);
            if (entry === undefined) {
                entry = {chunk, runStarts: EMPTY_RUNS, runLengths: EMPTY_RUNS, runTypeIds: EMPTY_RUNS, receivedAt: nowMs};
            }
            this._state.mapSet("overworld.byChunk", chunk, entry);
        }
    }

    /**
     * Local write: drops stale entries outside the rect, bounding memory at roughly the
     * last-viewed area.
     * @param {OverworldRect} rect
     * @param {number} nowMs
     * @param {number} ttlMs
     * @returns {void}
     */
    evictOutside(rect, nowMs, ttlMs) {
        const kept = new Set(rect.ordinals());
        const stale = [];
        for (const [chunk, entry] of this._state.mapEntries("overworld.byChunk")) {
            if (!kept.has(chunk) && nowMs - entry.receivedAt > ttlMs) {
                stale.push(chunk);
            }
        }
        for (const chunk of stale) {
            this._state.mapDelete("overworld.byChunk", chunk);
        }
    }
}

/**
 * Derived reads over the overworld namespace.
 */
export class OverworldView extends AbstractCacheView {

    /**
     * Whether any chunk of the rect is missing or older than the TTL.
     * @param {OverworldRect} rect
     * @param {number} nowMs
     * @param {number} ttlMs
     * @returns {boolean}
     */
    needsFetch(rect, nowMs, ttlMs) {
        for (const chunk of rect.ordinals()) {
            const entry = this._state.mapGet("overworld.byChunk", chunk);
            if (entry === undefined || nowMs - entry.receivedAt > ttlMs) {
                return true;
            }
        }
        return false;
    }
}
