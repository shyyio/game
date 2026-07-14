import {chunkId} from "@/common/util.js";
import {EasyObjectInsertEvent, EasyObjectSyncEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";
import {NO_EID} from "@/common/sim/GameEngine.js";
import {AbstractEasyModule} from "@/common/sim/AbstractEasyModule.js";

function tileKey(x, y) {
    return `${x},${y}`;
}

/**
 * A drop-in resource-body module for mods: give it a descriptor per resource type and call
 * {@link EasyResourceModule#install}; it owns placement, deletion, and chunk sync with no bespoke mod
 * code. A resource has no ports and no tick — it just marks its extraction tiles (the definition's
 * `extractionTiles`) with a resource type an extractor reads at placement, and renders as a sprite.
 * Each resource definition gets its own body component (one component per type, so no typeId field);
 * the extraction tiles share one ResourceCover component. `_covers` is a derived tile lookup rebuilt
 * on load.
 */
export class EasyResourceModule extends AbstractEasyModule {

    /**
     * @param {GameEngine} engine
     * @param {{definition:ObjectDefinition, resourceType:number, solid:boolean}[]} types - one entry
     *     per resource definition; `solid` bodies occupy their footprint (an extractor sits beside
     *     them), non-solid bodies do not (an extractor sits on the tile)
     */
    constructor(engine, types) {
        super(engine);

        // typeId -> body descriptor, one body component per resource definition.
        this._bodyByType = new Map();
        this._bodies = types.map(type => {
            const def = engine.defineComponent(type.definition.name, [
                {name: "clientId", fill: NO_EID},
                {name: "x"},
                {name: "y"},
                {name: "direction"},
            ]);
            const entry = {
                def,
                definition: type.definition,
                typeId: type.definition.typeId,
                resourceType: type.resourceType,
                solid: type.solid,
            };
            this._bodyByType.set(type.definition.typeId, entry);
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
     * @param {number} typeId
     * @returns {boolean}
     */
    handles(typeId) {
        return this._bodyByType.has(typeId);
    }

    /**
     * Places a resource body from a CreateObjectMessage, marking the definition's extraction tiles. A
     * solid body occupies its footprint (a no-op, still handled, when blocked); a non-solid one does
     * not.
     * @param {GameEngine} sim
     * @param {CreateObjectMessage} message
     * @returns {boolean}
     */
    place(sim, message) {
        const entry = this._bodyByType.get(message.typeId);
        if (entry.solid) {
            const footprint = sim.footprint(entry.definition, message.x, message.y, message.direction);
            if (!sim.occupancyFree(footprint)) {
                return true;
            }
            const clientId = this.placeResource(message.x, message.y, message.typeId, message.direction, entry.resourceType, entry.definition.extractionTiles);
            sim.track(clientId, footprint);
            return true;
        }
        this.placeResource(message.x, message.y, message.typeId, message.direction, entry.resourceType, entry.definition.extractionTiles);
        return true;
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
        const clientId = this.engine.createObjectId();
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
    remove(clientId) {
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
