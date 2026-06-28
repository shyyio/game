import {chunkKey} from "@/common/util.js";

/**
 * Client-side spatial store of every placed object, shared across all mods (the browser never
 * reads the simulation DB). Each record is `{id, tileX, tileY, chunk, cells, data}`: a primary
 * tile (for by-tile / by-chunk lookups), the cells it covers with their occupancy layer (for
 * collision / connection lookups), and a mod-defined `data` payload (kind, direction, type, …).
 * Object ids are globally unique (a single sequence across object types), so they key directly.
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
     * @param {object} [data]
     */
    set(id, tileX, tileY, cells, data={}) {
        this.remove(id);
        const chunk = chunkKey(tileX, tileY);
        const record = {id, tileX, tileY, chunk, cells, data};
        this._byId.set(id, record);

        const tileKey = ClientCache._tileKey(tileX, tileY);
        const tileRecords = this._byTile.get(tileKey);
        if (tileRecords === undefined) {
            this._byTile.set(tileKey, [record]);
        } else {
            tileRecords.push(record);
        }

        const chunkIds = this._byChunk.get(chunk);
        if (chunkIds === undefined) {
            this._byChunk.set(chunk, new Set([id]));
        } else {
            chunkIds.add(id);
        }

        cells.forEach(cell => {
            this._byCell.set(ClientCache._cellKey(cell.x, cell.y, cell.layer), record);
        });
    }

    /**
     * Merges `patch` into a record's `data`; no-op for unknown ids.
     * @param {BigInt} id
     * @param {object} patch
     */
    update(id, patch) {
        const record = this._byId.get(id);
        if (record === undefined) {
            return;
        }
        Object.assign(record.data, patch);
    }

    /**
     * @param {BigInt} id
     * @returns {object|null} the removed record, or null if the id was unknown
     */
    remove(id) {
        const record = this._byId.get(id);
        if (record === undefined) {
            return null;
        }
        this._byId.delete(id);

        const tileKey = ClientCache._tileKey(record.tileX, record.tileY);
        const tileRecords = this._byTile.get(tileKey);
        if (tileRecords !== undefined) {
            const remaining = tileRecords.filter(other => other.id !== id);
            if (remaining.length === 0) {
                this._byTile.delete(tileKey);
            } else {
                this._byTile.set(tileKey, remaining);
            }
        }

        const chunkIds = this._byChunk.get(record.chunk);
        if (chunkIds !== undefined) {
            chunkIds.delete(id);
            if (chunkIds.size === 0) {
                this._byChunk.delete(record.chunk);
            }
        }

        record.cells.forEach(cell => {
            const key = ClientCache._cellKey(cell.x, cell.y, cell.layer);
            if (this._byCell.get(key) === record) {
                this._byCell.delete(key);
            }
        });

        return record;
    }

    /**
     * @param {BigInt} id
     * @returns {object|null}
     */
    get(id) {
        const record = this._byId.get(id);
        return record === undefined ? null : record;
    }

    /**
     * Every record whose primary tile is (tileX, tileY).
     * @param {number} tileX
     * @param {number} tileY
     * @returns {object[]}
     */
    getAtTile(tileX, tileY) {
        const records = this._byTile.get(ClientCache._tileKey(tileX, tileY));
        return records === undefined ? [] : records;
    }

    /**
     * The object covering (tileX, tileY) on `layer`, or null.
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} layer
     * @returns {object|null}
     */
    at(tileX, tileY, layer) {
        const record = this._byCell.get(ClientCache._cellKey(tileX, tileY, layer));
        return record === undefined ? null : record;
    }

    /**
     * @param {string} chunk
     * @returns {object[]}
     */
    getByChunk(chunk) {
        const chunkIds = this._byChunk.get(chunk);
        if (chunkIds === undefined) {
            return [];
        }
        const records = [];
        chunkIds.forEach(id => {
            records.push(this._byId.get(id));
        });
        return records;
    }

    /**
     * Drops every record in `chunk`, returning the dropped ids.
     * @param {string} chunk
     * @returns {BigInt[]}
     */
    clearChunk(chunk) {
        const chunkIds = this._byChunk.get(chunk);
        if (chunkIds === undefined) {
            return [];
        }
        const ids = Array.from(chunkIds);
        ids.forEach(id => {
            this.remove(id);
        });
        return ids;
    }

    /**
     * @returns {object[]} every cached record
     */
    values() {
        return Array.from(this._byId.values());
    }
}
