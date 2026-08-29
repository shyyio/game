import {CHUNK_SIZE, REGION_SIZE} from "@/common/constants.js";
import {chunkId, chunkOrdinal, chunkOrigin} from "@/common/util.js";
import {OverworldSnapshotEvent} from "@/common/OverworldEvents.js";

const REGION_HALF = REGION_SIZE / 2;
const TILES_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE;

/**
 * One chunk's baked tile picture: typeId + 1 per tile, 0 = empty.
 */
class OverworldChunkBake {

    constructor() {
        this.tiles = new Uint16Array(TILES_PER_CHUNK);
        this.filled = 0;
    }
}

/**
 * The hot-read overworld map: a per-chunk bake of every overworld-visible object's tiles,
 * repainted on spawn/despawn so a snapshot never scans the ECS.
 */
export class OverworldBake {

    /**
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     */
    constructor(engine, placed) {
        this.engine = engine;
        this.placed = placed;
        // Chunk ordinal -> OverworldChunkBake, only chunks with visible tiles.
        this._chunks = new Map();
        placed.registerChunkObserver(chunk => this._repaintChunk(chunk));
        // After PlacedObjects' own hook (construction order), so _eidsByChunk is rebuilt.
        engine.snapshots.registerRebuildHook(() => this._rebuildAll());
    }

    /**
     * The baked runs of every non-empty chunk in the rect, as one snapshot event.
     * @param {number} chunkX
     * @param {number} chunkY
     * @param {number} chunkWidth
     * @param {number} chunkHeight
     * @returns {OverworldSnapshotEvent}
     */
    snapshot(chunkX, chunkY, chunkWidth, chunkHeight) {
        if (chunkX < -REGION_HALF || chunkY < -REGION_HALF
            || chunkX + chunkWidth > REGION_HALF || chunkY + chunkHeight > REGION_HALF) {
            throw new RangeError(`Overworld rect (${chunkX}, ${chunkY}) ${chunkWidth}x${chunkHeight} is outside the region`);
        }
        const event = new OverworldSnapshotEvent(chunkX, chunkY, chunkWidth, chunkHeight);
        for (let cy = chunkY; cy < chunkY + chunkHeight; cy += 1) {
            for (let cx = chunkX; cx < chunkX + chunkWidth; cx += 1) {
                const chunk = chunkOrdinal(cx, cy);
                const bake = this._chunks.get(chunk);
                if (bake !== undefined) {
                    this._appendRuns(event, chunk, bake.tiles);
                }
            }
        }
        return event;
    }

    /**
     * Emits a chunk's tiles as row-constrained runs (each run draws as one rect).
     * @private
     * @param {OverworldSnapshotEvent} event
     * @param {number} chunk
     * @param {Uint16Array} tiles
     * @returns {void}
     */
    _appendRuns(event, chunk, tiles) {
        const starts = [];
        const lengths = [];
        const typeIds = [];
        for (let row = 0; row < CHUNK_SIZE; row += 1) {
            const rowStart = row * CHUNK_SIZE;
            let runStart = -1;
            let runValue = 0;
            for (let column = 0; column <= CHUNK_SIZE; column += 1) {
                let value;
                if (column === CHUNK_SIZE) {
                    value = 0;
                } else {
                    value = tiles[rowStart + column];
                }
                if (value === runValue) {
                    continue;
                }
                if (runValue !== 0) {
                    starts.push(runStart);
                    lengths.push(rowStart + column - runStart);
                    typeIds.push(runValue - 1);
                }
                if (value !== 0) {
                    runStart = rowStart + column;
                }
                runValue = value;
            }
        }
        event.addChunk(chunk, starts, lengths, typeIds);
    }

    /**
     * Repaints one chunk's bake from its placed objects, dropping the record when none are visible.
     * @private
     * @param {number} chunk
     * @returns {void}
     */
    _repaintChunk(chunk) {
        const eids = this.placed.eidsInChunk(chunk);
        if (eids.size === 0) {
            this._chunks.delete(chunk);
            return;
        }
        // Higher drawLayerIndex paints last, matching map-mode z-order; objectId ties keep it
        // deterministic.
        const sorted = [...eids].sort((a, b) => {
            const layerA = this.placed.typeFor(this.placed.typeIdOf(a)).drawLayerIndex;
            const layerB = this.placed.typeFor(this.placed.typeIdOf(b)).drawLayerIndex;
            if (layerA !== layerB) {
                return layerA - layerB;
            }
            return this.placed.objectIdOf(a) - this.placed.objectIdOf(b);
        });
        const origin = chunkOrigin(chunk);
        const position = this.engine.Position;
        let bake = this._chunks.get(chunk);
        if (bake === undefined) {
            bake = new OverworldChunkBake();
        } else {
            bake.tiles.fill(0);
        }
        let filled = 0;
        for (const eid of sorted) {
            const type = this.placed.typeFor(this.placed.typeIdOf(eid));
            if (!type.overworldVisible) {
                continue;
            }
            const baseX = position.x[eid] - origin.x;
            const baseY = position.y[eid] - origin.y;
            const value = type.typeId + 1;
            for (const cell of type.geometry.tiles(position.direction[eid])) {
                const offset = (baseY + cell.y) * CHUNK_SIZE + baseX + cell.x;
                if (bake.tiles[offset] === 0) {
                    filled += 1;
                }
                bake.tiles[offset] = value;
            }
        }
        if (filled === 0) {
            this._chunks.delete(chunk);
            return;
        }
        bake.filled = filled;
        this._chunks.set(chunk, bake);
    }

    /**
     * Repaints every occupied chunk after a load.
     * @private
     * @returns {void}
     */
    _rebuildAll() {
        this._chunks = new Map();
        const position = this.engine.Position;
        const def = this.placed.def;
        const touched = new Set();
        for (let row = 0; row < def.count; row += 1) {
            const eid = def.eids[row];
            touched.add(chunkId(position.x[eid], position.y[eid]));
        }
        for (const chunk of touched) {
            this._repaintChunk(chunk);
        }
    }
}
