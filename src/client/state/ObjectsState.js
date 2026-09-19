import {EMPTY} from "@/sim/AbstractComponent.js";
import {ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {ObjectInsertEvent, ObjectSyncEvent, ObjectDeleteEvent, ObjectFieldsEvent} from "@/common/ObjectEvents.js";
import {TILE_VARIANT_LIMIT, chunkKeyAt, tileKeyAt, tileVariantKey} from "@/common/util.js";
import {portAt, edgeKey} from "@/common/portGeometry.js";
import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {DEV} from "@/common/env.js";
import {TILE_SIZE} from "@/client/constants.js";
import {AbstractCacheWriter, AbstractCacheView, schemaMap} from "@/client/state/ClientCache.js";
import {ListenerList} from "@/common/ListenerList.js";

export const OBJECTS_SCHEMA = {
    byId: schemaMap(),
};

/**
 * @typedef {object} ObjectState one placed object as the wire delivered it; render shapes
 *     (cells, resolved type) derive in the ObjectsView index
 * @property {number} id
 * @property {number} tileX
 * @property {number} tileY
 * @property {number} objectTypeId
 * @property {Direction} direction
 * @property {Object.<string, number>} ports rendered output ports, by PortDefinition name
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
            this._state.mapDelete("objects.byId", event.objectRef);
            return;
        }
        if (event instanceof ObjectFieldsEvent) {
            this._patchFields(event);
            return;
        }
        if (event instanceof ChunkUnsubscribeEvent) {
            // The chunk index lives on the view; getByChunk returns a fresh array, so the
            // per-delete index updates can't disturb the iteration.
            for (const entry of this._state.view("objects").getByChunk(event.chunkKey)) {
                this._state.mapDelete("objects.byId", entry.id);
            }
        }
    }

    /**
     * Patches an object's synced fields onto its entry's data, zipped against its behavior's
     * declared order; an event for an object no longer held is dropped.
     * @private
     * @param {ObjectFieldsEvent} event
     * @returns {void}
     */
    _patchFields(event) {
        const view = this._state.view("objects");
        const entry = view.get(event.objectRef);
        if (entry === null) {
            return;
        }
        const patch = {};
        for (const [i, field] of entry.data.type.behavior.syncedFields.fields.entries()) {
            patch[field.name] = event.values[i];
        }
        view.apply(event.objectRef, patch);
    }

    /**
     * @private
     * @param {ObjectInsertEvent|ObjectSyncEvent} event
     * @returns {void}
     */
    _set(event) {
        const type = this._registry.getObjectTypeByTypeId(event.objectTypeId);
        const ports = {};
        const renderedPorts = type.outputPorts.filter(port => port.render);
        for (const [i, port] of renderedPorts.entries()) {
            ports[port.name] = event.portRefs[i];
        }
        this._state.mapSet("objects.byId", event.objectRef, {
            id: event.objectRef,
            tileX: event.x,
            tileY: event.y,
            objectTypeId: event.objectTypeId,
            direction: event.direction,
            ports,
        });
    }
}


/**
 * The `data` payload of a derived-type cache entry, plus the behavior's synced fields under their
 * own names, starting at their defaults.
 */
export class ObjectClientEntry {

    /**
     * @param {ObjectType} type
     * @param {Direction} direction
     */
    constructor(type, direction) {
        this.type = type;
        this.direction = direction;
        const synced = type.behavior.syncedFields;
        if (synced === null) {
            return;
        }
        for (const field of synced.fields) {
            this[field.name] = field.defaultValue;
        }
    }
}

/**
 * @typedef {Object} TileBounds
 * @property {number} minTileX
 * @property {number} minTileY
 * @property {number} maxTileX
 * @property {number} maxTileY
 */

/**
 * @typedef {Object} PortMatch
 * @property {CacheEntry} entry
 * @property {string} portName
 */

/**
 * One placed object in the ObjectsView: a primary tile (for by-tile / by-chunk lookups), the
 * cells it covers with their position layer (for collision / connection lookups), a `data` payload
 * carrying at least the ObjectType (`data.type`) and direction, and its rendered output ports by
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
        this.chunkKey = chunkKeyAt(tileX, tileY);
        this.cells = cells;
        this.ports = ports;
        this.data = data;
    }

    /**
     * The PortDefinition name of one of this object's rendered output port refs, or undefined.
     * @param {number} portRef
     * @returns {string|undefined}
     */
    portName(portRef) {
        return Object.keys(this.ports).find(name => this.ports[name] === portRef);
    }

    /**
     * The footprint bounding box over the cells, in tiles.
     * @returns {TileBounds}
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
     * @returns {TilePosition}
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
     * The world-px center of the footprint.
     * @returns {Point}
     */
    get center() {
        const centroid = this.tileCentroid;
        return {
            x: (centroid.tileX + 0.5) * TILE_SIZE,
            y: (centroid.tileY + 0.5) * TILE_SIZE,
        };
    }

    /**
     * The type's behavior, or null for a typeless (test-built) entry.
     * @returns {AbstractBehavior|null}
     */
    get behavior() {
        const type = this.data.type;
        return type === undefined ? null : type.behavior;
    }

    /**
     * The synced field holding what this object offers as its product, or null for an object that
     * produces nothing.
     * @returns {ProductField|null}
     */
    getProductFieldOrNull() {
        const synced = this.behavior.syncedFields;
        if (synced === null) {
            return null;
        }
        return synced.productField;
    }

    /**
     * The item type this object offers as its product, or EMPTY while it offers none.
     * @returns {number}
     */
    get productItemTypeId() {
        const field = this.getProductFieldOrNull();
        if (field === null) {
            return EMPTY;
        }
        return this.data[field.name];
    }
}

/**
 * Client-side spatial store of every placed object, shared across all mods (the browser never
 * reads the simulation DB). Holds a {@link CacheEntry} per object, keyed by id (globally unique,
 * a single sequence across object types) and indexed by tile, chunk, cell, and rendered port ref.
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
         * Rendered output port ref -> the owning CacheEntry, so the item layer resolves a port-item
         * event to its object and PortDefinition.
         * @type {Map<number, CacheEntry>}
         * @private
         */
        this._byPort = new Map();
        /**
         * @type {ListenerList}
         * @private
         */
        this._setListeners = new ListenerList();
        /**
         * @type {ListenerList}
         * @private
         */
        this._removeListeners = new ListenerList();
        /**
         * @type {ListenerList}
         * @private
         */
        this._structuralListeners = new ListenerList();
        /**
         * @type {ListenerList}
         * @private
         */
        this._updateListeners = new ListenerList();
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
            const type = this._modRegistry.getObjectTypeByTypeId(object.objectTypeId);
            const cells = type.getPositionLayerTilesByDirection(object.direction).flatMap(group =>
                group.cells.map(cell => ({
                    x: object.tileX + cell.x,
                    y: object.tileY + cell.y,
                    layer: group.layer,
                })));
            this.set(id, object.tileX, object.tileY, cells, object.ports, new ObjectClientEntry(type, object.direction));
        });
    }

    /**
     * Registers a callback invoked with each entry as it's set (for sprite creation).
     * @param {function(CacheEntry): void} listener
     * @returns {function(): void} unsubscribe
     */
    onSet(listener) {
        return this._setListeners.add(listener);
    }

    /**
     * Registers a callback invoked with each entry as it's removed (for sprite cleanup).
     * @param {function(CacheEntry): void} listener
     * @returns {function(): void} unsubscribe
     */
    onRemove(listener) {
        return this._removeListeners.add(listener);
    }

    /**
     * Registers a callback invoked whenever an object is added or removed, for layers that
     * re-derive rendering from neighboring objects.
     * @param {function(): void} listener
     * @returns {function(): void} unsubscribe
     */
    onStructuralChange(listener) {
        return this._structuralListeners.add(listener);
    }

    /**
     * Registers a callback invoked with each entry whose `data` was patched via {@link apply}.
     * @param {function(CacheEntry): void} listener
     * @returns {function(): void} unsubscribe
     */
    onUpdate(listener) {
        return this._updateListeners.add(listener);
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @returns {number}
     * @private
     */
    static _tileKey(tileX, tileY) {
        return tileKeyAt(tileX, tileY);
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
    _getCellKeyByEid(tileX, tileY, layer) {
        let code = this._layerCodes.get(layer);
        if (code === undefined) {
            code = this._layerCodes.size;
            if (DEV && code >= TILE_VARIANT_LIMIT) {
                throw new RangeError(`Position layer "${layer}" exceeds the ${TILE_VARIANT_LIMIT} the cell index keys on`);
            }
            this._layerCodes.set(layer, code);
        }
        return tileVariantKey(tileKeyAt(tileX, tileY), code);
    }

    /**
     * Registers (or replaces) an object: its primary tile, the cells it covers with their
     * layer, and a data payload.
     * @param {number} id
     * @param {number} tileX
     * @param {number} tileY
     * @param {{x: number, y: number, layer: string}[]} cells
     * @param {Object.<string, number>} [ports] - rendered output ports, by PortDefinition name
     * @param {object} [data]
     */
    set(id, tileX, tileY, cells, ports={}, data={}) {
        this.remove(id);
        const entry = new CacheEntry(id, tileX, tileY, cells, ports, data);
        this._byId.set(id, entry);

        for (const portRef of Object.values(ports)) {
            this._byPort.set(portRef, entry);
        }

        const tileKey = ObjectsView._tileKey(tileX, tileY);
        const tileEntries = this._byTile.get(tileKey);
        if (tileEntries === undefined) {
            this._byTile.set(tileKey, [entry]);
        } else {
            tileEntries.push(entry);
        }

        const objectRefs = this._byChunk.get(entry.chunkKey);
        if (objectRefs === undefined) {
            this._byChunk.set(entry.chunkKey, new Set([id]));
        } else {
            objectRefs.add(id);
        }

        for (const cell of cells) {
            const key = this._getCellKeyByEid(cell.x, cell.y, cell.layer);
            const stacked = this._byCell.get(key);
            if (stacked === undefined) {
                this._byCell.set(key, [entry]);
            } else {
                stacked.push(entry);
            }
        }

        this._setListeners.notify(entry);
        this._structuralListeners.notify();
    }

    /**
     * Merges `patch` into an entry's `data` and notifies apply listeners; no-op for unknown ids.
     * @param {number} id
     * @param {object} patch
     */
    apply(id, patch) {
        const entry = this._byId.get(id);
        if (entry === undefined) {
            return;
        }
        Object.assign(entry.data, patch);
        this._updateListeners.notify(entry);
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

        const objectRefs = this._byChunk.get(entry.chunkKey);
        if (objectRefs !== undefined) {
            objectRefs.delete(id);
            if (objectRefs.size === 0) {
                this._byChunk.delete(entry.chunkKey);
            }
        }

        for (const cell of entry.cells) {
            const key = this._getCellKeyByEid(cell.x, cell.y, cell.layer);
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

        for (const portRef of Object.values(entry.ports)) {
            if (this._byPort.get(portRef) === entry) {
                this._byPort.delete(portRef);
            }
        }

        this._removeListeners.notify(entry);
        this._structuralListeners.notify();
        return entry;
    }

    /**
     * The entry owning a rendered output port ref, or null.
     * @param {number} portRef
     * @returns {CacheEntry|null}
     */
    getByPort(portRef) {
        const entry = this._byPort.get(portRef);
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
    getObjectAtOrNull(tileX, tileY, layer) {
        // A layer nothing has ever been stored on holds nothing; reads never register one.
        const code = this._layerCodes.get(layer);
        if (code === undefined) {
            return null;
        }
        const stacked = this._byCell.get(tileVariantKey(tileKeyAt(tileX, tileY), code));
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
    getObjectsAt(tileX, tileY, layer) {
        const code = this._layerCodes.get(layer);
        if (code === undefined) {
            return [];
        }
        const stacked = this._byCell.get(tileVariantKey(tileKeyAt(tileX, tileY), code));
        if (stacked === undefined) {
            return [];
        }
        return Array.from(stacked);
    }

    /**
     * The object of `type` occupying (tileX, tileY) on its position layer, or null.
     * @param {number} tileX
     * @param {number} tileY
     * @param {ObjectType} type
     * @returns {CacheEntry|null}
     */
    getObjectByTypeAtOrNull(tileX, tileY, type) {
        const entry = this.getObjectAtOrNull(tileX, tileY, type.positionLayer);
        if (entry !== null && entry.data.type.objectTypeId === type.objectTypeId) {
            return entry;
        }
        return null;
    }

    /**
     * @param {number} chunkKey
     * @returns {CacheEntry[]}
     */
    getByChunk(chunkKey) {
        const objectRefs = this._byChunk.get(chunkKey);
        if (objectRefs === undefined) {
            return [];
        }
        const entries = [];
        for (const id of objectRefs) {
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
     * sits on its own input cell.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @returns {PortMatch|null}
     */
    getInputPortAtOrNull(tileX, tileY, direction) {
        const entry = this.getObjectAtOrNull(tileX, tileY, LAYER_SURFACE);
        if (entry === null) {
            return null;
        }
        return this._getPortMatchOrNull(entry, "inputPorts", tileX, tileY, direction);
    }

    /**
     * The entry with an output port reaching (tileX, tileY) facing `direction`, or null. The parent
     * sits one tile back (its output reaches forward).
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @returns {PortMatch|null}
     */
    getOutputPortAtOrNull(tileX, tileY, direction) {
        const sourceX = tileX - Direction.dx(direction);
        const sourceY = tileY - Direction.dy(direction);
        const entry = this.getObjectAtOrNull(sourceX, sourceY, LAYER_SURFACE);
        if (entry === null) {
            return null;
        }
        return this._getPortMatchOrNull(entry, "outputPorts", tileX, tileY, direction);
    }

    /**
     * The `portKind` port of `entry` whose rotated world cell is (portX, portY) facing `facing`, or
     * null.
     * @param {CacheEntry} entry
     * @param {("inputPorts"|"outputPorts")} portKind
     * @param {number} portX
     * @param {number} portY
     * @param {Direction} facing
     * @returns {PortMatch|null}
     * @private
     */
    _getPortMatchOrNull(entry, portKind, portX, portY, facing) {
        const target = edgeKey(portX, portY, facing);
        for (const candidate of entry.data.type.getSurfacePortsByKind(portKind)) {
            const placed = portAt(candidate, entry.tileX, entry.tileY, entry.data.direction);
            if (edgeKey(placed.x, placed.y, placed.direction) === target) {
                return {entry, portName: candidate.name};
            }
        }
        return null;
    }

    /**
     * The ports of `entry` connected to a neighbor: the stub's geometry tile (tileX/tileY), the
     * neighbor cell reached (neighborX/neighborY), and the neighbor entry. Two objects connect
     * where one's output port and the other's input port share a cell and facing — derived from
     * each definition's rotated ports (mod-agnostic).
     * @param {CacheEntry|{tileX: number, tileY: number, data: object}} entry - needs data.type, data.direction
     * @returns {{key: string, isOutput: boolean, tileX: number, tileY: number, neighborX: number, neighborY: number, neighbor: CacheEntry}[]}
     */
    connectedPorts(entry) {
        const type = entry.data.type;
        const direction = entry.data.direction;
        const connections = [];

        for (const port of type.getSurfacePortsByKind("outputPorts")) {
            const placed = portAt(port, entry.tileX, entry.tileY, direction);
            const consumer = this.getInputPortAtOrNull(placed.x, placed.y, placed.direction);
            if (consumer !== null) {
                // An output port's stub sits on the emitting tile; the cell it reaches is the neighbor's.
                connections.push({
                    key: port.name,
                    isOutput: true,
                    tileX: placed.x - Direction.dx(placed.direction),
                    tileY: placed.y - Direction.dy(placed.direction),
                    neighborX: placed.x,
                    neighborY: placed.y,
                    neighbor: consumer.entry,
                });
            }
        }

        for (const port of type.getSurfacePortsByKind("inputPorts")) {
            const placed = portAt(port, entry.tileX, entry.tileY, direction);
            const parent = this.getOutputPortAtOrNull(placed.x, placed.y, placed.direction);
            if (parent !== null) {
                // An input port's stub sits on its own cell; the parent is the tile behind it.
                connections.push({
                    key: port.name,
                    isOutput: false,
                    tileX: placed.x,
                    tileY: placed.y,
                    neighborX: placed.x - Direction.dx(placed.direction),
                    neighborY: placed.y - Direction.dy(placed.direction),
                    neighbor: parent.entry,
                });
            }
        }

        return connections;
    }
}
