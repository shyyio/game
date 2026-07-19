import {AbstractTileMeshDrawLayer} from "@/client/AbstractTileMeshDrawLayer.js";
import {AnimatedTile} from "@/client/AnimatedTileMesh.js";
import {getOrCreate} from "@/common/util.js";

// Output (front) and input (back) connection stubs, rotated by the object's facing.
const OUTPUT_CONNECTION = "machine-connection-top-up";
const INPUT_CONNECTION = "machine-connection-bottom-up";

// The stub sequences, in frame table slot order.
const CONNECTION_SEQUENCES = [OUTPUT_CONNECTION, INPUT_CONNECTION];

/**
 * One animated half-belt stub bridging a port to whatever it connects to.
 */
class Connection {

    /**
     * @param {number} sequence - frame table slot
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} quarterTurns - clockwise 90-degree turns, from the object's facing
     */
    constructor(
        sequence,
        tileX,
        tileY,
        quarterTurns,
    ) {
        this.sequence = sequence;
        this.tileX = tileX;
        this.tileY = tileY;
        this.quarterTurns = quarterTurns;
    }
}

/**
 * The single shared connection layer: draws an animated stub at each connected port of every cached
 * object whose definition opts in (`renderConnections`). Connection geometry is re-derived only for
 * the objects a cache change touched, and only on-screen chunks are mounted.
 */
export class ConnectionDrawLayer extends AbstractTileMeshDrawLayer {

    constructor() {
        super();
        // Connection geometry per object id, re-derived only when the object or a neighbor changes.
        this._connections = new Map();
        // The chunk each object's stubs hang under, and the objects each chunk holds.
        this._objectChunks = new Map();
        this._chunkObjects = new Map();
        // Object ids whose connections need re-deriving on the next tick.
        this._dirty = new Set();
    }

    get layerIndex() {
        // Above belts (10) but below belt items (15), so items ride over the connection stubs.
        return 14;
    }

    get meshSequences() {
        return CONNECTION_SEQUENCES;
    }

    /**
     * Hidden in map mode (the stubs are sprite-only detail).
     * @returns {void}
     */
    _applyMapMode() {
        this.visible = !this._mapMode;
    }

    /**
     * Hidden in map mode; stale meshes catch up on zoom-in.
     * @returns {void}
     */
    _tickMapMode() {}

    /**
     * The mesh may have gone stale while the chunk was unmounted.
     * @param {number} chunk
     * @returns {void}
     */
    _onChunkMounted(chunk) {
        this._rebuildChunkSprites(chunk);
    }

    /**
     * Re-derives the connections a cache change invalidated, then advances every live stub.
     * @param {number} frame animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @returns {void}
     */
    _updateSprites(frame, deltaMS) {
        if (this.textureRegistry === null) {
            return;
        }
        this._flushDirty();
        super._updateSprites(frame, deltaMS);
    }

    /**
     * Queues an object and its connected neighbors for re-derivation: the change may have made or
     * broken a connection on either side of the port pair.
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheChange(entry) {
        if (entry.data.type.renderConnections) {
            this._dirty.add(entry.id);
        }
        for (const connection of this.cache.connectedPorts(entry)) {
            if (connection.neighbor.data.type.renderConnections) {
                this._dirty.add(connection.neighbor.id);
            }
        }
    }

    /**
     * Re-derives every queued object's connections, marking the chunks whose meshes that changed.
     * @returns {void}
     * @private
     */
    _flushDirty() {
        if (this._dirty.size === 0) {
            return;
        }
        for (const id of this._dirty) {
            const entry = this.cache.get(id);
            if (entry === null) {
                this._connections.delete(id);
            } else {
                this._connections.set(id, this._deriveConnections(entry));
            }
            this._reindex(id, entry);
        }
        this._dirty.clear();
    }

    /**
     * Moves an object between chunks as its stubs appear, move, or go away, dirtying whichever
     * chunks that touched.
     * @param {number} id
     * @param {CacheEntry|null} entry
     * @returns {void}
     * @private
     */
    _reindex(id, entry) {
        const connections = this._connections.get(id);
        const drawn = entry !== null && connections !== undefined && connections.length > 0;
        const chunk = drawn ? entry.chunk : undefined;
        const previous = this._objectChunks.get(id);
        if (previous === chunk) {
            if (drawn) {
                this._dirtyChunks.add(chunk);
            }
            return;
        }

        if (previous !== undefined) {
            const objects = this._chunkObjects.get(previous);
            objects.delete(id);
            this._objectChunks.delete(id);
            this._memberRemoved(previous, objects.size === 0);
        }
        if (!drawn) {
            return;
        }

        this._objectChunks.set(id, chunk);
        getOrCreate(this._chunkObjects, chunk, () => new Set()).add(id);
        this._memberAdded(chunk);
    }

    /**
     * The stubs of every object the chunk holds.
     * @param {number} chunk
     * @returns {AnimatedTile[]}
     */
    _buildTiles(chunk) {
        const tiles = [];
        for (const id of this._chunkObjects.get(chunk)) {
            for (const connection of this._connections.get(id)) {
                tiles.push(new AnimatedTile(
                    connection.tileX,
                    connection.tileY,
                    connection.quarterTurns,
                    connection.sequence,
                ));
            }
        }
        return tiles;
    }

    /**
     * @param {number} chunk
     * @returns {void}
     */
    _onChunkDropped(chunk) {
        super._onChunkDropped(chunk);
        this._chunkObjects.delete(chunk);
    }

    /**
     * The stubs `entry` should show: one per connected port, on the port's own side of the pair.
     * @param {CacheEntry} entry
     * @returns {Connection[]}
     * @private
     */
    _deriveConnections(entry) {
        const quarterTurns = entry.data.direction;
        const connections = [];

        for (const connection of this.cache.connectedPorts(entry)) {
            const base = connection.isOutput ? OUTPUT_CONNECTION : INPUT_CONNECTION;
            connections.push(new Connection(
                this._slotOf(base),
                connection.tileX,
                connection.tileY,
                quarterTurns,
            ));
        }
        return connections;
    }
}
