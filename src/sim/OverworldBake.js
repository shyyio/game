import {CHUNK_SIZE, REGION_SIZE} from "@/common/constants.js";
import {chunkKeyAt, chunkOrdinal, chunkOrigin} from "@/common/util.js";
import {AbstractSystem} from "@/sim/AbstractSystem.js";
import {OverworldSnapshotEvent} from "@/common/OverworldEvents.js";

const REGION_HALF = REGION_SIZE / 2;
const TILES_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE;

/**
 * One chunk's baked tile picture: objectTypeId + 1 per tile, 0 = empty.
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
export class OverworldBake extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     */
    constructor(engine, placed) {
        super();
        this.engine = engine;
        this.placed = placed;
        // Chunk ordinal -> OverworldChunkBake, only chunks with visible tiles.
        this._chunks = new Map();
        // After PlacedObjects, so its chunk index is rebuilt before the repaint.
        engine.registerSystem(this);
    }

    /**
     * The baked runs of every non-empty chunk in the rect, as one snapshot event.
     * @param {number} chunkX
     * @param {number} chunkY
     * @param {number} chunkWidth
     * @param {number} chunkHeight
     * @returns {OverworldSnapshotEvent}
     */
    getSnapshotInRect(chunkX, chunkY, chunkWidth, chunkHeight) {
        if (chunkX < -REGION_HALF || chunkY < -REGION_HALF
            || chunkX + chunkWidth > REGION_HALF || chunkY + chunkHeight > REGION_HALF) {
            throw new RangeError(`Overworld rect (${chunkX}, ${chunkY}) ${chunkWidth}x${chunkHeight} is outside the region`);
        }
        const event = new OverworldSnapshotEvent(chunkX, chunkY, chunkWidth, chunkHeight);
        for (let cy = chunkY; cy < chunkY + chunkHeight; cy += 1) {
            for (let cx = chunkX; cx < chunkX + chunkWidth; cx += 1) {
                const chunkKey = chunkOrdinal(cx, cy);
                const bake = this._chunks.get(chunkKey);
                if (bake !== undefined) {
                    this._appendRuns(event, chunkKey, bake.tiles);
                }
            }
        }
        return event;
    }

    /**
     * Emits a chunk's tiles as row-constrained runs (each run draws as one rect).
     * @private
     * @param {OverworldSnapshotEvent} event
     * @param {number} chunkKey
     * @param {Uint16Array} tiles
     * @returns {void}
     */
    _appendRuns(event, chunkKey, tiles) {
        const starts = [];
        const lengths = [];
        const objectTypeIds = [];
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
                    objectTypeIds.push(runValue - 1);
                }
                if (value !== 0) {
                    runStart = rowStart + column;
                }
                runValue = value;
            }
        }
        event.addChunk(chunkKey, starts, lengths, objectTypeIds);
    }

    onChunkChanged(chunkKey) {
        this._repaintChunk(chunkKey);
    }

    /**
     * Repaints one chunk's bake from its placed objects, dropping the record when none are visible.
     * @private
     * @param {number} chunkKey
     * @returns {void}
     */
    _repaintChunk(chunkKey) {
        const eids = this.placed.getEidsByChunkKey(chunkKey);
        if (eids.size === 0) {
            this._chunks.delete(chunkKey);
            return;
        }
        // Higher drawLayerIndex paints last, matching map-mode z-order; objectRef ties keep it
        // deterministic.
        const sorted = Array.from(eids).sort((a, b) => {
            const layerA = this.placed.getObjectTypeByTypeId(this.placed.getObjectTypeIdByEid(a)).drawLayerIndex;
            const layerB = this.placed.getObjectTypeByTypeId(this.placed.getObjectTypeIdByEid(b)).drawLayerIndex;
            if (layerA !== layerB) {
                return layerA - layerB;
            }
            return this.placed.getObjectRefByEid(a) - this.placed.getObjectRefByEid(b);
        });
        const origin = chunkOrigin(chunkKey);
        const position = this.engine.Position;
        let bake = this._chunks.get(chunkKey);
        if (bake === undefined) {
            bake = new OverworldChunkBake();
        } else {
            bake.tiles.fill(0);
        }
        let filled = 0;
        for (const eid of sorted) {
            const type = this.placed.getObjectTypeByTypeId(this.placed.getObjectTypeIdByEid(eid));
            if (!type.overworldVisible) {
                continue;
            }
            const baseX = position.x[eid] - origin.x;
            const baseY = position.y[eid] - origin.y;
            const value = type.objectTypeId + 1;
            for (const cell of type.geometry.getTilesByDirection(position.direction[eid])) {
                const offset = (baseY + cell.y) * CHUNK_SIZE + baseX + cell.x;
                if (bake.tiles[offset] === 0) {
                    filled += 1;
                }
                bake.tiles[offset] = value;
            }
        }
        if (filled === 0) {
            this._chunks.delete(chunkKey);
            return;
        }
        bake.filled = filled;
        this._chunks.set(chunkKey, bake);
    }

    /**
     * Repaints every occupied chunk after a load.
     * @returns {void}
     */
    rebuild() {
        this._chunks = new Map();
        const position = this.engine.Position;
        const objects = this.placed.objects;
        const touched = new Set();
        for (let row = 0; row < objects.count; row += 1) {
            const eid = objects.eids[row];
            touched.add(chunkKeyAt(position.x[eid], position.y[eid]));
        }
        for (const chunk of touched) {
            this._repaintChunk(chunk);
        }
    }
}
