import {chunkKey} from "@/common/util.js";

/**
 * A content-agnostic, client-side spatial store of placed objects. Client mods own
 * an instance (one per object kind) and use it as their queryable picture of the
 * world: tools and context menus read it instead of touching the simulation
 * database, which the browser does not own in multiplayer.
 *
 * Records are `{id, tileX, tileY, chunk, data}` where `data` is the mod's opaque
 * payload (e.g. a belt's `{direction, type, parentX, parentY}`). A tile may hold
 * more than one object (e.g. a surface belt and a buried underground belt), so
 * tile lookups return an array.
 */
export class ViewportCache {

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
     * @param {BigInt} id
     * @param {number} tileX
     * @param {number} tileY
     * @param {object} data
     */
    insert(id, tileX, tileY, data) {
        const chunk = chunkKey(tileX, tileY);
        const record = {id, tileX, tileY, chunk, data};
        this._byId.set(id, record);

        const tileKey = ViewportCache._tileKey(tileX, tileY);
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
    }

    /**
     * Merges `patch` into an existing record's `data`. No-op if the id is unknown.
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

        const tileKey = ViewportCache._tileKey(record.tileX, record.tileY);
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
     * @param {number} tileX
     * @param {number} tileY
     * @returns {object[]}
     */
    getAtTile(tileX, tileY) {
        const tileRecords = this._byTile.get(ViewportCache._tileKey(tileX, tileY));
        return tileRecords === undefined ? [] : tileRecords;
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
     * Drops every record in `chunk`. Returns the dropped ids so the caller can
     * remove the matching sprites — the chunk-unsubscribe path.
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
}
