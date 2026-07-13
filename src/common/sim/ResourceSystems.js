import {chunkId} from "@/common/util.js";
import {EasyObjectInsertEvent, EasyObjectSyncEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";
import {NO_EID} from "@/common/sim/EcsEngine.js";

function tileKey(x, y) {
    return `${x},${y}`;
}

/**
 * Placed resource bodies (water, volcano) on the bitECS engine. A resource has no ports and no tick —
 * it just marks its extraction tiles with a resource type (which an extractor reads at placement) and
 * renders as a sprite. Each resource definition gets its own body component (one component per type,
 * so no typeId field); the extraction tiles share one ResourceCover component. `_covers` is a derived
 * tile lookup rebuilt on load.
 */
export class ResourceModule {

    /**
     * @param {EcsEngine} engine
     * @param {{name:string, typeId:number}[]} types - one body component per resource definition
     */
    constructor(engine, types) {
        this.engine = engine;

        // typeId -> {def, typeId}, one body component per resource definition.
        this._bodyByType = new Map();
        this._bodies = types.map(type => {
            const def = engine.defineComponent(type.name, [
                {name: "clientId", fill: NO_EID},
                {name: "x"},
                {name: "y"},
                {name: "direction"},
            ]);
            const entry = {def, typeId: type.typeId};
            this._bodyByType.set(type.typeId, entry);
            return entry;
        });

        this.coverDef = engine.defineComponent("ResourceCover", [
            {name: "x"},
            {name: "y"},
            {name: "resourceType"},
            {name: "owner", fill: NO_EID},
        ]);

        // Extraction tile key -> resource type; derived index over ResourceCover, rebuilt on load.
        this._covers = new Map();

        engine.registerRebuildHook(() => this._resync());
    }

    /**
     * The {body entry, eid} of the resource with client id `clientId`, or null.
     * @param {number} clientId
     * @returns {{entry:object, eid:number}|null}
     */
    _find(clientId) {
        for (let i = 0; i < this._bodies.length; i += 1) {
            const entry = this._bodies[i];
            const eid = this.engine.entitiesWith(entry.def).find(candidate => entry.def.store.clientId[candidate] === clientId);
            if (eid !== undefined) {
                return {entry, eid};
            }
        }
        return null;
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
        const entry = this._bodyByType.get(typeId);
        const body = entry.def.store;
        const clientId = this.engine.allocateObjectId();
        const bodyEid = this.engine.createEntity(entry.def);
        body.clientId[bodyEid] = clientId;
        body.x[bodyEid] = x;
        body.y[bodyEid] = y;
        body.direction[bodyEid] = direction;

        const cover = this.coverDef.store;
        extractionOffsets.forEach(offset => {
            const tileX = x + offset.x;
            const tileY = y + offset.y;
            const eid = this.engine.createEntity(this.coverDef);
            cover.x[eid] = tileX;
            cover.y[eid] = tileY;
            cover.resourceType[eid] = resourceType;
            cover.owner[eid] = clientId;
            this._covers.set(tileKey(tileX, tileY), resourceType);
        });

        this.engine.emitEvent(new EasyObjectInsertEvent(entry.typeId, clientId, x, y, direction, [], null));
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
        const found = this._find(clientId);
        if (found === null) {
            return false;
        }
        const body = found.entry.def.store;
        const cover = this.coverDef.store;
        this.engine.entitiesWith(this.coverDef).forEach(eid => {
            if (cover.owner[eid] === clientId) {
                this._covers.delete(tileKey(cover.x[eid], cover.y[eid]));
                this.engine.destroyEntity(eid);
            }
        });
        this.engine.emitEvent(new EasyObjectDeleteEvent(found.entry.typeId, clientId, body.x[found.eid], body.y[found.eid]));
        this.engine.destroyEntity(found.eid);
        return true;
    }

    /**
     * Rebuilds the tile-cover lookup after a load repopulates the world.
     * @private
     * @returns {void}
     */
    _resync() {
        this._covers = new Map();
        const cover = this.coverDef.store;
        this.engine.entitiesWith(this.coverDef).forEach(eid => {
            this._covers.set(tileKey(cover.x[eid], cover.y[eid]), cover.resourceType[eid]);
        });
    }

    /**
     * @param {number} chunk
     * @returns {EasyObjectSyncEvent[]}
     */
    chunkSync(chunk) {
        const events = [];
        this._bodies.forEach(entry => {
            const body = entry.def.store;
            this.engine.entitiesWith(entry.def).forEach(eid => {
                if (chunkId(body.x[eid], body.y[eid]) === chunk) {
                    events.push(new EasyObjectSyncEvent(
                        entry.typeId, body.clientId[eid], body.x[eid], body.y[eid], body.direction[eid], [], null,
                    ));
                }
            });
        });
        return events;
    }
}
