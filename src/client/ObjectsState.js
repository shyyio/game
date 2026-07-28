import {ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {ObjectInsertEvent, ObjectSyncEvent, ObjectDeleteEvent} from "@/common/ObjectEvents.js";
import {TILE_VARIANT_LIMIT, chunkId, rotate, tileId, tileVariantId} from "@/common/util.js";
import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {DEV} from "@/common/env.js";
import {AbstractCacheWriter, AbstractCacheView, schemaMap} from "@/client/ClientCache.js";

export const OBJECTS_SCHEMA = {
    byId: schemaMap(),
};

/**
 * @typedef {object} ObjectState one placed object as the wire delivered it; render shapes
 *     (cells, resolved type) derive in the ObjectsView index
 * @property {number} id
 * @property {number} tileX
 * @property {number} tileY
 * @property {number} typeId
 * @property {Direction} direction
 * @property {Object.<string, number>} ports rendered out-ports, by PortDefinition name
 * @property {number|null} lastProduced
 */

/**
 * Writes the placed-object mirror from the generic object lifecycle events; registered first so
 * object state lands before any reader.
 */
export class ObjectsWriter extends AbstractCacheWriter {

    /**
     * @param {ModRegistry} registry
     * @param {ClientCache} state
     */
    constructor(registry, state) {
        super(state);
        this._registry = registry;
    }

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof ObjectInsertEvent || event instanceof ObjectSyncEvent) {
            this._set(event);
            return;
        }
        if (event instanceof ObjectDeleteEvent) {
            this._state.mapDelete("objects.byId", event.id);
            return;
        }
        if (event instanceof ChunkUnsubscribeEvent) {
            // The chunk index lives on the view; getByChunk returns a fresh array, so the
            // per-delete index updates can't disturb the iteration.
            for (const entry of this._state.view("objects").getByChunk(event.chunk)) {
                this._state.mapDelete("objects.byId", entry.id);
            }
        }
    }

    /**
     * @private
     * @param {ObjectInsertEvent|ObjectSyncEvent} event
     * @returns {void}
     */
    _set(event) {
        const type = this._registry.typeById(event.typeId);
        const ports = {};
        const renderedPorts = type.outputPorts.filter(port => port.render);
        for (const [i, port] of renderedPorts.entries()) {
            ports[port.name] = event.portIds[i];
        }
        // A sync without an output keeps the last produced item already mirrored.
        let lastProduced = event.lastOutput;
        if (lastProduced === null) {
            const previous = this._state.mapGet("objects.byId", event.id);
            if (previous !== undefined) {
                lastProduced = previous.lastProduced;
            }
        }
        this._state.mapSet("objects.byId", event.id, {
            id: event.id,
            tileX: event.x,
            tileY: event.y,
            typeId: event.typeId,
            direction: event.direction,
            ports,
            lastProduced,
        });
    }
}


/**
 * The `data` payload of a derived-type cache entry.
 */
export class ObjectClientData {

    /**
     * @param {ObjectType} type
     * @param {Direction} direction
     */
    constructor(type, direction) {
        this.type = type;
        this.direction = direction;
    }
}

/**
 * One placed object in the ObjectsView: a primary tile (for by-tile / by-chunk lookups), the
 * cells it covers with their position layer (for collision / connection lookups), a `data` payload
 * carrying at least the ObjectType (`data.type`) and direction, and its rendered out-ports by
 * PortDefinition name.
 */
export class CacheEntry {

    /**
     * @param {number} id
     * @param {number} tileX
     * @param {number} tileY
     * @param {{x: number, y: number, layer: string}[]} cells
     * @param {Object.<string, number>} ports
     * @param {object} data
     */
    constructor(id, tileX, tileY, cells, ports, data) {
        this.id = id;
        this.tileX = tileX;
        this.tileY = tileY;
        this.chunk = chunkId(tileX, tileY);
        this.cells = cells;
        this.ports = ports;
        this.data = data;
    }

    /**
     * The PortDefinition name of one of this object's rendered out-port ids, or undefined.
     * @param {number} portId
     * @returns {string|undefined}
     */
    portName(portId) {
        return Object.keys(this.ports).find(name => this.ports[name] === portId);
    }

    /**
     * The footprint bounding box over the cells, in tiles.
     * @returns {{minTileX: number, minTileY: number, maxTileX: number, maxTileY: number}}
     */
    get tileBounds() {
        let minTileX = this.cells[0].x;
        let minTileY = this.cells[0].y;
        let maxTileX = minTileX;
        let maxTileY = minTileY;
        for (const cell of this.cells) {
            minTileX = Math.min(minTileX, cell.x);
            minTileY = Math.min(minTileY, cell.y);
            maxTileX = Math.max(maxTileX, cell.x);
            maxTileY = Math.max(maxTileY, cell.y);
        }
        return {minTileX, minTileY, maxTileX, maxTileY};
    }

    /**
     * The footprint centroid, in fractional tiles.
     * @returns {{tileX: number, tileY: number}}
     */
    get tileCentroid() {
        let sumX = 0;
        let sumY = 0;
        for (const cell of this.cells) {
            sumX += cell.x;
            sumY += cell.y;
        }
        return {tileX: sumX / this.cells.length, tileY: sumY / this.cells.length};
    }

    /**
     * The type's behavior, or null for a typeless (test-built) entry.
     * @returns {AbstractBehavior|null}
     */
    get behavior() {
        const type = this.data.type;
        return type === undefined ? null : type.behavior;
    }
}

/**
 * Client-side spatial store of every placed object, shared across all mods (the browser never
 * reads the simulation DB). Holds a {@link CacheEntry} per object, keyed by id (globally unique,
 * a single sequence across object types) and indexed by tile, chunk, cell, and rendered port id.
 */
export class ObjectsView extends AbstractCacheView {

    /**
     * @param {ModRegistry|null} modRegistry type resolution for onBind; null for a typeless
     *     (test-built) view that is never bound
     */
    constructor(modRegistry) {
        super();
        this._modRegistry = modRegistry;
        /**
         * @type {Map<number, CacheEntry>}
         * @private
         */
        this._byId = new Map();
        /**
         * @type {Map<number, CacheEntry[]>}
         * @private
         */
        this._byTile = new Map();
        /**
         * @type {Map<number, Set<number>>}
         * @private
         */
        this._byChunk = new Map();
        /**
         * Cell key -> entries covering the cell, later-set last (overlaps stack, e.g. an extractor
         * over a non-solid water body); removal uncovers what's beneath.
         * @type {Map<number, CacheEntry[]>}
         * @private
         */
        this._byCell = new Map();
        /**
         * Position layer name -> its ordinal in the cell key, assigned on first use.
         * @type {Map<string, number>}
         * @private
         */
        this._layerCodes = new Map();
        /**
         * Rendered out-port id -> the owning CacheEntry, so the item layer resolves a port-item
         * event to its object and PortDefinition.
         * @type {Map<number, CacheEntry>}
         * @private
         */
        this._byPort = new Map();
        /**
         * @type {Array<function(CacheEntry): void>}
         * @private
         */
        this._setListeners = [];
        /**
         * @type {Array<function(CacheEntry): void>}
         * @private
         */
        this._removeListeners = [];
        /**
         * @type {Array<function(): void>}
         * @private
         */
        this._structuralListeners = [];
    }

    /**
     * Subscribes to the objects namespace, materializing each literal into an indexed
     * {@link CacheEntry} with its ObjectType resolved and footprint cells derived.
     * @returns {void}
     */
    onBind() {
        this._state.subscribe("objects.byId", (id, object) => {
            if (object === undefined) {
                this.remove(id);
                return;
            }
            const type = this._modRegistry.typeById(object.typeId);
            const cells = type.positionLayerTiles(object.direction).flatMap(group =>
                group.cells.map(cell => ({
                    x: object.tileX + cell.x,
                    y: object.tileY + cell.y,
                    layer: group.layer,
                })));
            this.set(id, object.tileX, object.tileY, cells, object.ports, new ObjectClientData(type, object.direction));
        });
    }

    /**
     * Registers a callback invoked with each entry as it's set (for sprite creation).
     * @param {function(CacheEntry): void} listener
     * @returns {function(): void} unsubscribe
     */
    onSet(listener) {
        this._setListeners.push(listener);
        return () => {
            const index = this._setListeners.indexOf(listener);
            if (index !== -1) {
                this._setListeners.splice(index, 1);
            }
        };
    }

    /**
     * Registers a callback invoked with each entry as it's removed (for sprite cleanup).
     * @param {function(CacheEntry): void} listener
     * @returns {function(): void} unsubscribe
     */
    onRemove(listener) {
        this._removeListeners.push(listener);
        return () => {
            const index = this._removeListeners.indexOf(listener);
            if (index !== -1) {
                this._removeListeners.splice(index, 1);
            }
        };
    }

    /**
     * Registers a callback invoked whenever an object is added or removed, for layers that
     * re-derive rendering from neighboring objects.
     * @param {function(): void} listener
     * @returns {function(): void} unsubscribe
     */
    onStructuralChange(listener) {
        this._structuralListeners.push(listener);
        return () => {
            const index = this._structuralListeners.indexOf(listener);
            if (index !== -1) {
                this._structuralListeners.splice(index, 1);
            }
        };
    }

    /**
     * @private
     * @returns {void}
     */
    _notifyStructural() {
        for (const listener of [...this._structuralListeners]) {
            listener();
        }
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @returns {number}
     * @private
     */
    static _tileKey(tileX, tileY) {
        return tileId(tileX, tileY);
    }

    /**
     * The cell index key. Layers are named strings, so each gets an ordinal on first sight and the
     * key stays a number — a lookup then allocates nothing, which matters because chunk sync calls
     * this thousands of times per burst. Mirrors the engine's own layer codes.
     * @param {number} tileX
     * @param {number} tileY
     * @param {string} layer
     * @returns {number}
     * @private
     */
    _cellKey(tileX, tileY, layer) {
        let code = this._layerCodes.get(layer);
        if (code === undefined) {
            code = this._layerCodes.size;
            if (DEV && code >= TILE_VARIANT_LIMIT) {
                throw new RangeError(`Position layer "${layer}" exceeds the ${TILE_VARIANT_LIMIT} the cell index keys on`);
            }
            this._layerCodes.set(layer, code);
        }
        return tileVariantId(tileId(tileX, tileY), code);
    }

    /**
     * Registers (or replaces) an object: its primary tile, the cells it covers with their
     * layer, and a data payload.
     * @param {number} id
     * @param {number} tileX
     * @param {number} tileY
     * @param {{x: number, y: number, layer: string}[]} cells
     * @param {Object.<string, number>} [ports] - rendered out-ports, by PortDefinition name
     * @param {object} [data]
     */
    set(id, tileX, tileY, cells, ports={}, data={}) {
        this.remove(id);
        const entry = new CacheEntry(id, tileX, tileY, cells, ports, data);
        this._byId.set(id, entry);

        for (const portId of Object.values(ports)) {
            this._byPort.set(portId, entry);
        }

        const tileKey = ObjectsView._tileKey(tileX, tileY);
        const tileEntries = this._byTile.get(tileKey);
        if (tileEntries === undefined) {
            this._byTile.set(tileKey, [entry]);
        } else {
            tileEntries.push(entry);
        }

        const chunkIds = this._byChunk.get(entry.chunk);
        if (chunkIds === undefined) {
            this._byChunk.set(entry.chunk, new Set([id]));
        } else {
            chunkIds.add(id);
        }

        for (const cell of cells) {
            const key = this._cellKey(cell.x, cell.y, cell.layer);
            const stacked = this._byCell.get(key);
            if (stacked === undefined) {
                this._byCell.set(key, [entry]);
            } else {
                stacked.push(entry);
            }
        }

        for (const listener of [...this._setListeners]) {
            listener(entry);
        }
        this._notifyStructural();
    }

    /**
     * Merges `patch` into an entry's `data`; no-op for unknown ids.
     * @param {number} id
     * @param {object} patch
     */
    update(id, patch) {
        const entry = this._byId.get(id);
        if (entry === undefined) {
            return;
        }
        Object.assign(entry.data, patch);
    }

    /**
     * @param {number} id
     * @returns {CacheEntry|null} the removed entry, or null if the id was unknown
     */
    remove(id) {
        const entry = this._byId.get(id);
        if (entry === undefined) {
            return null;
        }
        this._byId.delete(id);

        const tileKey = ObjectsView._tileKey(entry.tileX, entry.tileY);
        const tileEntries = this._byTile.get(tileKey);
        if (tileEntries !== undefined) {
            const remaining = tileEntries.filter(other => other.id !== id);
            if (remaining.length === 0) {
                this._byTile.delete(tileKey);
            } else {
                this._byTile.set(tileKey, remaining);
            }
        }

        const chunkIds = this._byChunk.get(entry.chunk);
        if (chunkIds !== undefined) {
            chunkIds.delete(id);
            if (chunkIds.size === 0) {
                this._byChunk.delete(entry.chunk);
            }
        }

        for (const cell of entry.cells) {
            const key = this._cellKey(cell.x, cell.y, cell.layer);
            const stacked = this._byCell.get(key);
            if (stacked === undefined) {
                continue;
            }
            const index = stacked.indexOf(entry);
            if (index !== -1) {
                stacked.splice(index, 1);
            }
            if (stacked.length === 0) {
                this._byCell.delete(key);
            }
        }

        for (const portId of Object.values(entry.ports)) {
            if (this._byPort.get(portId) === entry) {
                this._byPort.delete(portId);
            }
        }

        for (const listener of [...this._removeListeners]) {
            listener(entry);
        }
        this._notifyStructural();
        return entry;
    }

    /**
     * The object's tile position, for the inspect panel's connectors.
     * @param {number} objectId
     * @returns {{x: number, y: number}|undefined}
     */
    positionOf(objectId) {
        const entry = this.get(objectId);
        if (entry === null) {
            return undefined;
        }
        return {x: entry.tileX, y: entry.tileY};
    }

    /**
     * The object's last produced item, for the inspect panel's output slot.
     * @param {number} objectId
     * @returns {number|undefined}
     */
    lastProducedOf(objectId) {
        const object = this._state.mapGet("objects.byId", objectId);
        if (object === undefined || object.lastProduced === null) {
            return undefined;
        }
        return object.lastProduced;
    }

    /**
     * The entry owning a rendered out-port id, or null.
     * @param {number} portId
     * @returns {CacheEntry|null}
     */
    getByPort(portId) {
        const entry = this._byPort.get(portId);
        if (entry === undefined) {
            return null;
        }
        return entry;
    }

    /**
     * @param {number} id
     * @returns {CacheEntry|null}
     */
    get(id) {
        const entry = this._byId.get(id);
        if (entry === undefined) {
            return null;
        }
        return entry;
    }

    /**
     * Every entry whose primary tile is (tileX, tileY).
     * @param {number} tileX
     * @param {number} tileY
     * @returns {CacheEntry[]}
     */
    getAtTile(tileX, tileY) {
        const entries = this._byTile.get(ObjectsView._tileKey(tileX, tileY));
        if (entries === undefined) {
            return [];
        }
        return entries;
    }

    /**
     * The topmost (latest-set) object covering (tileX, tileY) on `layer`, or null.
     * @param {number} tileX
     * @param {number} tileY
     * @param {string} layer
     * @returns {CacheEntry|null}
     */
    at(tileX, tileY, layer) {
        // A layer nothing has ever been stored on holds nothing; reads never register one.
        const code = this._layerCodes.get(layer);
        if (code === undefined) {
            return null;
        }
        const stacked = this._byCell.get(tileVariantId(tileId(tileX, tileY), code));
        if (stacked === undefined) {
            return null;
        }
        return stacked[stacked.length - 1];
    }

    /**
     * Every object covering (tileX, tileY) on `layer`, bottom-up (latest-set last).
     * @param {number} tileX
     * @param {number} tileY
     * @param {string} layer
     * @returns {CacheEntry[]}
     */
    allAt(tileX, tileY, layer) {
        const code = this._layerCodes.get(layer);
        if (code === undefined) {
            return [];
        }
        const stacked = this._byCell.get(tileVariantId(tileId(tileX, tileY), code));
        if (stacked === undefined) {
            return [];
        }
        return [...stacked];
    }

    /**
     * The object of `type` occupying (tileX, tileY) on its position layer, or null.
     * @param {number} tileX
     * @param {number} tileY
     * @param {ObjectType} type
     * @returns {CacheEntry|null}
     */
    objectAt(tileX, tileY, type) {
        const entry = this.at(tileX, tileY, type.positionLayer);
        if (entry !== null && entry.data.type.typeId === type.typeId) {
            return entry;
        }
        return null;
    }

    /**
     * @param {number} chunk
     * @returns {CacheEntry[]}
     */
    getByChunk(chunk) {
        const chunkIds = this._byChunk.get(chunk);
        if (chunkIds === undefined) {
            return [];
        }
        const entries = [];
        for (const id of chunkIds) {
            entries.push(this._byId.get(id));
        }
        return entries;
    }

    /**
     * @returns {CacheEntry[]} every cached entry
     */
    values() {
        return Array.from(this._byId.values());
    }

    /**
     * The entry with an input port at (tileX, tileY) facing `direction`, or null. The consumer
     * sits on its own input cell. Mirrors the server's input-port lookup.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @returns {{entry: CacheEntry, portName: string}|null}
     */
    inPortAt(tileX, tileY, direction) {
        const entry = this.at(tileX, tileY, LAYER_SURFACE);
        if (entry === null) {
            return null;
        }
        return this._portMatch(entry, "inputPorts", tileX, tileY, direction);
    }

    /**
     * The entry with an output port reaching (tileX, tileY) facing `direction`, or null. The feeder
     * sits one tile back (its output reaches forward). Mirrors the server's GetOutPort{direction}.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @returns {{entry: CacheEntry, portName: string}|null}
     */
    outPortAt(tileX, tileY, direction) {
        const sourceX = tileX - Direction.dx(direction);
        const sourceY = tileY - Direction.dy(direction);
        const entry = this.at(sourceX, sourceY, LAYER_SURFACE);
        if (entry === null) {
            return null;
        }
        return this._portMatch(entry, "outputPorts", tileX, tileY, direction);
    }

    /**
     * The `portKind` port of `entry` whose rotated world cell is (portX, portY) facing `facing`, or
     * null.
     * @param {CacheEntry} entry
     * @param {("inputPorts"|"outputPorts")} portKind
     * @param {number} portX
     * @param {number} portY
     * @param {Direction} facing
     * @returns {{entry: CacheEntry, portName: string}|null}
     * @private
     */
    _portMatch(entry, portKind, portX, portY, facing) {
        const port = entry.data.type.surfacePorts(portKind).find(candidate => {
            const rotated = rotate(candidate, entry.data.direction);
            return entry.tileX + rotated.x === portX
                && entry.tileY + rotated.y === portY
                && rotated.direction === facing;
        });
        if (port === undefined) {
            return null;
        }
        return {entry, portName: port.name};
    }

    /**
     * The ports of `record` connected to a neighbor: the stub's geometry tile (tileX/tileY), the
     * neighbor cell reached (neighborX/neighborY), and the neighbor entry. Two objects connect
     * where one's output port and the other's input port share a cell and facing — derived from
     * each definition's rotated ports (mod-agnostic).
     * @param {CacheEntry|{tileX: number, tileY: number, data: object}} record - needs data.type, data.direction
     * @returns {{key: string, isOutput: boolean, tileX: number, tileY: number, neighborX: number, neighborY: number, neighbor: CacheEntry}[]}
     */
    connectedPorts(record) {
        const type = record.data.type;
        const direction = record.data.direction;
        const connections = [];

        for (const port of type.surfacePorts("outputPorts")) {
            const rotated = rotate(port, direction);
            const portX = record.tileX + rotated.x;
            const portY = record.tileY + rotated.y;
            const consumer = this.inPortAt(portX, portY, rotated.direction);
            if (consumer !== null) {
                connections.push({
                    key: port.name,
                    isOutput: true,
                    tileX: portX - Direction.dx(rotated.direction),
                    tileY: portY - Direction.dy(rotated.direction),
                    neighborX: portX,
                    neighborY: portY,
                    neighbor: consumer.entry,
                });
            }
        }

        for (const port of type.surfacePorts("inputPorts")) {
            const rotated = rotate(port, direction);
            const portX = record.tileX + rotated.x;
            const portY = record.tileY + rotated.y;
            const feeder = this.outPortAt(portX, portY, rotated.direction);
            if (feeder !== null) {
                connections.push({
                    key: port.name,
                    isOutput: false,
                    tileX: portX,
                    tileY: portY,
                    neighborX: portX - Direction.dx(rotated.direction),
                    neighborY: portY - Direction.dy(rotated.direction),
                    neighbor: feeder.entry,
                });
            }
        }

        return connections;
    }
}
