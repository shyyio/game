import {chunkId} from "@/common/util.js";
import {EasyObjectInsertEvent, EasyObjectSyncEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";

function tileKey(x, y) {
    return `${x},${y}`;
}

/**
 * Placed resource bodies (water, volcano) on the bitECS engine. A resource has no ports and no tick —
 * it just marks its extraction tiles with a resource type (which an extractor reads at placement) and
 * renders as a sprite. Mirrors the SQL EasyResource placement.
 */
export class ResourceModule {

    /**
     * @param {EcsEngine} engine
     */
    constructor(engine) {
        this.engine = engine;
        // Extraction tile key -> resource type covering it.
        this._covers = new Map();
        // clientId -> {typeId, x, y, direction, tiles} (resources have no tick entity).
        this._meta = new Map();
    }

    /**
     * Places a resource at (x, y), marking its extraction tiles (relative offsets) with `resourceType`.
     * @param {number} x
     * @param {number} y
     * @param {number} typeId
     * @param {Direction} direction
     * @param {number} resourceType
     * @param {{x:number, y:number}[]} extractionOffsets
     * @returns {number} the client id
     */
    placeResource(x, y, typeId, direction, resourceType, extractionOffsets) {
        const clientId = this.engine.allocateObjectId();
        const tiles = extractionOffsets.map(offset => tileKey(x + offset.x, y + offset.y));
        tiles.forEach(key => this._covers.set(key, resourceType));
        this._meta.set(clientId, {typeId, x, y, direction, tiles});
        this.engine.emitEvent(new EasyObjectInsertEvent(typeId, clientId, x, y, direction, [], null));
        return clientId;
    }

    /**
     * The resource type covering tile (x, y), or null.
     * @param {number} x
     * @param {number} y
     * @returns {number|null}
     */
    coverAt(x, y) {
        const cover = this._covers.get(tileKey(x, y));
        return cover === undefined ? null : cover;
    }

    /**
     * @param {number} clientId
     * @returns {boolean}
     */
    removeResourceById(clientId) {
        const meta = this._meta.get(clientId);
        if (meta === undefined) {
            return false;
        }
        meta.tiles.forEach(key => this._covers.delete(key));
        this._meta.delete(clientId);
        this.engine.emitEvent(new EasyObjectDeleteEvent(meta.typeId, clientId, meta.x, meta.y));
        return true;
    }

    /**
     * @param {number} chunk
     * @returns {EasyObjectSyncEvent[]}
     */
    chunkSync(chunk) {
        const events = [];
        this._meta.forEach((meta, clientId) => {
            if (chunkId(meta.x, meta.y) === chunk) {
                events.push(new EasyObjectSyncEvent(meta.typeId, clientId, meta.x, meta.y, meta.direction, [], null));
            }
        });
        return events;
    }
}
