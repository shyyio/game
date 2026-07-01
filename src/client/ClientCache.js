import {chunkId, rotate} from "@/common/util.js";
import {Direction, OCCUPANCY_LAYER_SURFACE} from "@/common/constants.js";

/**
 * One placed object in the ClientCache: a primary tile (for by-tile / by-chunk lookups), the
 * cells it covers with their occupancy layer (for collision / connection lookups), a mod-defined
 * `data` payload (kind, direction, type, …), and its rendered out-ports by PortDefinition name.
 */
export class CacheEntry {

    /**
     * @param {BigInt} id
     * @param {number} tileX
     * @param {number} tileY
     * @param {{x: number, y: number, layer: number}[]} cells
     * @param {Object.<string, BigInt>} ports
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
     * @param {BigInt} portId
     * @returns {string|undefined}
     */
    portName(portId) {
        return Object.keys(this.ports).find(name => this.ports[name] === portId);
    }
}

/**
 * Client-side spatial store of every placed object, shared across all mods (the browser never
 * reads the simulation DB). Holds a {@link CacheEntry} per object, keyed by id (globally unique,
 * a single sequence across object types) and indexed by tile, chunk, cell, and rendered port id.
 */
export class ClientCache {

    constructor() {
        /**
         * @type {Map<BigInt, object>}
         * @private
         */
        this._byId = new Map();
        /**
         * @type {Map<string, object[]>}
         * @private
         */
        this._byTile = new Map();
        /**
         * @type {Map<string, Set<BigInt>>}
         * @private
         */
        this._byChunk = new Map();
        /**
         * @type {Map<string, object>}
         * @private
         */
        this._byCell = new Map();
        /**
         * Rendered out-port id -> the owning CacheEntry, so the item layer resolves a port-item
         * event to its object and PortDefinition.
         * @type {Map<BigInt, CacheEntry>}
         * @private
         */
        this._byPort = new Map();
        /**
         * @type {function(CacheEntry): void[]}
         * @private
         */
        this._removeListeners = [];
        /**
         * @type {function(): void[]}
         * @private
         */
        this._structuralListeners = [];
    }

    /**
     * Registers a callback invoked with each entry as it's removed (for sprite cleanup).
     * @param {function(CacheEntry): void} listener
     */
    onRemove(listener) {
        this._removeListeners.push(listener);
    }

    /**
     * Registers a callback invoked whenever an object is added or removed, for layers that
     * re-derive rendering from neighboring objects.
     * @param {function(): void} listener
     */
    onStructuralChange(listener) {
        this._structuralListeners.push(listener);
    }

    /**
     * @private
     * @returns {void}
     */
    _notifyStructural() {
        this._structuralListeners.forEach(listener => listener());
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @returns {string}
     * @private
     */
    static _tileKey(tileX, tileY) {
        return tileX + "," + tileY;
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} layer
     * @returns {string}
     * @private
     */
    static _cellKey(tileX, tileY, layer) {
        return tileX + "," + tileY + "," + layer;
    }

    /**
     * Registers (or replaces) an object: its primary tile, the cells it covers with their
     * layer, and a data payload.
     * @param {BigInt} id
     * @param {number} tileX
     * @param {number} tileY
     * @param {{x: number, y: number, layer: number}[]} cells
     * @param {Object.<string, BigInt>} [ports] - rendered out-ports, by PortDefinition name
     * @param {object} [data]
     */
    set(id, tileX, tileY, cells, ports={}, data={}) {
        this.remove(id);
        const entry = new CacheEntry(id, tileX, tileY, cells, ports, data);
        this._byId.set(id, entry);

        Object.values(ports).forEach(portId => {
            this._byPort.set(portId, entry);
        });

        const tileKey = ClientCache._tileKey(tileX, tileY);
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

        cells.forEach(cell => {
            this._byCell.set(ClientCache._cellKey(cell.x, cell.y, cell.layer), entry);
        });

        this._notifyStructural();
    }

    /**
     * Merges `patch` into an entry's `data`; no-op for unknown ids.
     * @param {BigInt} id
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
     * @param {BigInt} id
     * @returns {CacheEntry|null} the removed entry, or null if the id was unknown
     */
    remove(id) {
        const entry = this._byId.get(id);
        if (entry === undefined) {
            return null;
        }
        this._byId.delete(id);

        const tileKey = ClientCache._tileKey(entry.tileX, entry.tileY);
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

        entry.cells.forEach(cell => {
            const key = ClientCache._cellKey(cell.x, cell.y, cell.layer);
            if (this._byCell.get(key) === entry) {
                this._byCell.delete(key);
            }
        });

        Object.values(entry.ports).forEach(portId => {
            if (this._byPort.get(portId) === entry) {
                this._byPort.delete(portId);
            }
        });

        this._removeListeners.forEach(listener => listener(entry));
        this._notifyStructural();
        return entry;
    }

    /**
     * The entry owning a rendered out-port id, or null.
     * @param {BigInt} portId
     * @returns {CacheEntry|null}
     */
    getByPort(portId) {
        const entry = this._byPort.get(portId);
        return entry === undefined ? null : entry;
    }

    /**
     * @param {BigInt} id
     * @returns {CacheEntry|null}
     */
    get(id) {
        const entry = this._byId.get(id);
        return entry === undefined ? null : entry;
    }

    /**
     * Every entry whose primary tile is (tileX, tileY).
     * @param {number} tileX
     * @param {number} tileY
     * @returns {CacheEntry[]}
     */
    getAtTile(tileX, tileY) {
        const entries = this._byTile.get(ClientCache._tileKey(tileX, tileY));
        return entries === undefined ? [] : entries;
    }

    /**
     * The object covering (tileX, tileY) on `layer`, or null.
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} layer
     * @returns {CacheEntry|null}
     */
    at(tileX, tileY, layer) {
        const entry = this._byCell.get(ClientCache._cellKey(tileX, tileY, layer));
        return entry === undefined ? null : entry;
    }

    /**
     * The object of `definition` occupying (tileX, tileY) on its occupancy layer, or null.
     * @param {number} tileX
     * @param {number} tileY
     * @param {ObjectDefinition} definition
     * @returns {CacheEntry|null}
     */
    objectAt(tileX, tileY, definition) {
        const entry = this.at(tileX, tileY, definition.occupancyLayer);
        return entry !== null && entry.data.definition === definition ? entry : null;
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
        chunkIds.forEach(id => {
            entries.push(this._byId.get(id));
        });
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
     * sits on its own input cell. Mirrors the server's GetInPort{dir}.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @returns {{entry: CacheEntry, portName: string}|null}
     */
    inPortAt(tileX, tileY, direction) {
        const entry = this.at(tileX, tileY, OCCUPANCY_LAYER_SURFACE);
        if (entry === null) {
            return null;
        }
        return this._portMatch(entry, "inputPorts", tileX, tileY, direction);
    }

    /**
     * The entry with an output port reaching (tileX, tileY) facing `direction`, or null. The feeder
     * sits one tile back (its output reaches forward). Mirrors the server's GetOutPort{dir}.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @returns {{entry: CacheEntry, portName: string}|null}
     */
    outPortAt(tileX, tileY, direction) {
        const sourceX = tileX - Direction.dx(direction);
        const sourceY = tileY - Direction.dy(direction);
        const entry = this.at(sourceX, sourceY, OCCUPANCY_LAYER_SURFACE);
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
        const port = entry.data.definition[portKind].find(candidate => {
            const rotated = rotate(candidate, entry.data.direction);
            return entry.tileX + rotated.x === portX
                && entry.tileY + rotated.y === portY
                && rotated.direction === facing;
        });
        return port === undefined ? null : {entry, portName: port.name};
    }

    /**
     * The ports of `record` connected to a neighbor: the stub's geometry tile (tileX/tileY), the
     * neighbor cell reached (neighborX/neighborY), and the neighbor entry. Two objects connect
     * where one's output port and the other's input port share a cell and facing — derived from
     * each definition's rotated ports (mod-agnostic).
     * @param {CacheEntry|{tileX: number, tileY: number, data: object}} record - needs data.definition, data.direction
     * @returns {{key: string, isOutput: boolean, tileX: number, tileY: number, neighborX: number, neighborY: number, neighbor: CacheEntry}[]}
     */
    connectedPorts(record) {
        const definition = record.data.definition;
        const direction = record.data.direction;
        const connections = [];

        definition.outputPorts.forEach(port => {
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
        });

        definition.inputPorts.forEach(port => {
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
        });

        return connections;
    }
}
