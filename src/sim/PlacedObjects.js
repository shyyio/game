import {NO_EID} from "@/sim/AbstractComponent.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent, ObjectDeleteEvent, ObjectSyncBatchEvent} from "@/common/ObjectEvents.js";
import {Direction, PLAYER_REF_NONE} from "@/common/constants.js";
import {chunkKeyAt, chunkOrigin} from "@/common/util.js";
import {PlacedObjectComponent} from "@/sim/PlacedObjectComponent.js";
import {AbstractSystem} from "@/sim/AbstractSystem.js";
import {METRICS_ENTRY_TYPE_OBJECT_PLACED, METRICS_ENTRY_TYPE_OBJECT_DESPAWNED} from "@/common/MetricsEntry.js";

const EMPTY_EIDS = new Set();

/**
 * The generic entity host for every derived (behavior-driven) object type: the shared PlacedObject
 * component, the objectRef -> eid index, and the ONE spawn/despawn/chunk-sync/inspect path. Built by
 * the engine before sim mods wire up; installs each frozen type's behavior once per behavior class.
 */
export class PlacedObjects extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     * @param {ModRegistry} registry
     */
    constructor(engine, registry) {
        super();
        this.engine = engine;
        this.objects = engine.components.register(new PlacedObjectComponent());

        // objectTypeId -> ObjectType, derived types only.
        this._types = new Map();
        // objectTypeId -> behavior, a dense array over the positional objectTypeIds: the tick loops resolve a
        // behavior per entity per tick, so this stays off a Map lookup.
        this._behaviors = [];
        this._eidByObjectRef = new Map();
        // Chunk -> the eids placed in it, so a subscribing session syncs a chunk without a scan of
        // every placed object in the world.
        this._eidsByChunk = new Map();
        // Before the behaviors install, so a chunk syncs its objects before what references them.
        engine.registerSystem(this);

        for (const type of registry.objectTypes) {
            this._types.set(type.objectTypeId, type);
            this._behaviors[type.objectTypeId] = type.behavior;
        }
    }

    /**
     * Installs each behavior class once; called by the engine once `engine.placed` is this host, so
     * an installing behavior can reach it.
     * @returns {void}
     */
    installBehaviors() {
        const installed = new Set();
        for (const type of this._types.values()) {
            if (!installed.has(type.behavior.constructor)) {
                installed.add(type.behavior.constructor);
                type.behavior.install(this.engine);
                const synced = type.behavior.syncedFields;
                if (synced !== null) {
                    this.engine.sync.register(this.engine.components.getComponentByName(synced.component), synced.fields);
                }
            }
        }
    }

    /**
     * The type of a placed entity.
     * @param {number} eid
     * @returns {number}
     */
    getObjectTypeIdByEid(eid) {
        return this.objects.store.objectTypeId[this.objects.getRowByEid(eid)];
    }

    /**
     * The client-facing object ref of a placed entity.
     * @param {number} eid
     * @returns {number}
     */
    getObjectRefByEid(eid) {
        return this.objects.store.objectRef[this.objects.getRowByEid(eid)];
    }

    /**
     * The player who placed this entity, PLAYER_REF_NONE for an engine-originated spawn.
     * @param {number} eid
     * @returns {number}
     */
    getPlacerByEid(eid) {
        return this.objects.store.placedBy[this.objects.getRowByEid(eid)];
    }

    /**
     * The current owner of the chunk this entity stands in, PLAYER_REF_NONE when unclaimed. Read
     * live.
     * @param {number} eid
     * @returns {number}
     */
    getClaimOwnerByEid(eid) {
        const position = this.engine.Position;
        return this.engine.chunkOwners.getOwnerByChunkKey(chunkKeyAt(position.x[eid], position.y[eid]));
    }

    /**
     * The behavior instance owning `objectTypeId`'s entities.
     * @param {number} objectTypeId
     * @returns {AbstractBehavior}
     */
    getBehaviorByTypeId(objectTypeId) {
        return this._behaviors[objectTypeId];
    }

    /**
     * The ObjectType with `objectTypeId`, derived types only.
     * @param {number} objectTypeId
     * @returns {ObjectType|undefined}
     */
    getObjectTypeByTypeId(objectTypeId) {
        return this._types.get(objectTypeId);
    }

    /**
     * The placed entities of one type.
     * @param {number} objectTypeId
     * @returns {number[]}
     */
    getEidsByTypeId(objectTypeId) {
        const column = this.objects.store.objectTypeId;
        const eids = this.objects.eids;
        const matches = [];
        for (let row = 0; row < this.objects.count; row += 1) {
            if (column[row] === objectTypeId) {
                matches.push(eids[row]);
            }
        }
        return matches;
    }

    /**
     * The placed entity occupying a cell, NO_EID when it is free.
     * @param {number} tileX
     * @param {number} tileY
     * @param {string} layer
     * @returns {number}
     */
    getEidAt(tileX, tileY, layer) {
        const objectRef = this.engine.space.getOwnerAt(tileX, tileY, layer);
        if (objectRef === null) {
            return NO_EID;
        }
        const eid = this._eidByObjectRef.get(objectRef);
        if (eid === undefined) {
            throw new Error(`Cell ${tileX},${tileY} on layer ${layer} is owned by unknown object ${objectRef}`);
        }
        return eid;
    }

    /**
     * Places an object as the engine rather than a player, so sim code adds one without replaying a
     * message.
     * @param {object} config
     * @param {number} config.objectTypeId
     * @param {number} config.tileX
     * @param {number} config.tileY
     * @param {Direction} config.direction
     * @param {number} [config.placedBy]
     * @returns {number} the eid, NO_EID when a guard or an occupied cell refused it
     */
    spawn({objectTypeId, tileX, tileY, direction, placedBy = PLAYER_REF_NONE}) {
        const message = new CreateObjectMessage(objectTypeId, tileX, tileY, direction);
        this._place(message, placedBy);
        const type = this._types.get(objectTypeId);
        if (type === undefined) {
            return NO_EID;
        }
        return this.getEidBySlot(tileX, tileY, type.getPositionLayerTilesByDirection(message.direction)[0].layer);
    }

    /**
     * Removes a placed object as the engine rather than a player.
     * @param {number} eid
     * @returns {void}
     */
    despawn(eid) {
        const objectRef = this.getObjectRefByEid(eid);
        this.engine.untrack(objectRef);
        this._delete(objectRef, PLAYER_REF_NONE);
        this.engine.ports.collectUnreferenced();
    }

    /**
     * The placed entity with object ref `objectRef`, or undefined.
     * @param {number} objectRef
     * @returns {number|null}
     */
    getEidByObjectRefOrNull(objectRef) {
        const eid = this._eidByObjectRef.get(objectRef);
        if (eid === undefined) {
            return null;
        }
        return eid;
    }

    /**
     * The eids placed in a chunk.
     * @param {number} chunkKey
     * @returns {Set<number>}
     */
    getEidsByChunkKey(chunkKey) {
        const held = this._eidsByChunk.get(chunkKey);
        if (held === undefined) {
            return EMPTY_EIDS;
        }
        return held;
    }

    dispatchMessage(message, playerRef) {
        if (message instanceof CreateObjectMessage) {
            return this._place(message, playerRef);
        }
        if (message instanceof DeleteObjectMessage) {
            return this._delete(message.objectRef, playerRef);
        }
        return false;
    }

    /**
     * The generic spawn path: footprint/position check (honoring placement.solid), the PlacedObject
     * columns, the behavior's wiring, and the insert event. Returns false for types the host doesn't
     * own (bespoke placement falls through to the mod's own handler).
     * @private
     * @param {CreateObjectMessage} message
     * @param {number} playerRef
     * @returns {boolean}
     */
    _place(message, playerRef) {
        const type = this._types.get(message.objectTypeId);
        if (type === undefined) {
            return false;
        }
        if (!type.directional) {
            // A non-directional type ignores the sender's facing.
            message.direction = Direction.UP;
        }
        const engine = this.engine;
        // Chunk-keyed sync and position indexing assume every object lives in exactly one chunk.
        if (type.geometry.isSpanningChunks(message.x, message.y, message.direction)) {
            return true;
        }
        if (!type.behavior.canSpawn(engine, type, message)) {
            return true;
        }
        if (!engine.isPlacementAllowed(type, message.x, message.y, message.direction)) {
            return true;
        }
        const footprint = engine.getFootprintAt(type, message.x, message.y, message.direction);
        if (type.placement.solid && !engine.space.isEveryCellFree(footprint)) {
            return true;
        }
        const eid = this.objects.create();
        const objectRef = engine.createObjectRef();
        const row = this.objects.getRowByEid(eid);
        this.objects.store.objectTypeId[row] = type.objectTypeId;
        this.objects.store.objectRef[row] = objectRef;
        this.objects.store.placedBy[row] = playerRef;
        engine.space.setPosition(eid, message.x, message.y, message.direction);
        engine.ports.bindEndpoints(eid, type, message.x, message.y, message.direction);
        type.behavior.onSpawn(engine, eid, type, message);
        const synced = type.behavior.syncedFields;
        if (synced !== null) {
            engine.sync.markSpawned(engine.components.getComponentByName(synced.component), eid);
        }
        if (type.placement.solid) {
            engine.track(objectRef, footprint);
        }
        this._eidByObjectRef.set(objectRef, eid);
        this._indexChunk(eid, message.x, message.y);
        engine.notifyChunkChanged(chunkKeyAt(message.x, message.y));
        engine.notifySpawn(eid, objectRef);
        const portEids = type.behavior.getRenderedPortEids(engine, eid);
        engine.emitEvent(new ObjectInsertEvent(type.objectTypeId, objectRef, message.x, message.y, message.direction, portEids));
        engine.emitMetrics(METRICS_ENTRY_TYPE_OBJECT_PLACED, playerRef, type.objectTypeId, 1);
        return true;
    }

    /**
     * The generic despawn path; an index miss returns false (a bespoke type's delete falls through).
     * @private
     * @param {number} objectRef
     * @param {number} playerRef
     * @returns {boolean}
     */
    _delete(objectRef, playerRef) {
        const eid = this._eidByObjectRef.get(objectRef);
        if (eid === undefined) {
            return false;
        }
        const engine = this.engine;
        const position = engine.Position;
        const type = this._types.get(this.getObjectTypeIdByEid(eid));
        engine.ports.unbindEndpoints(eid);
        type.behavior.onDespawn(engine, eid);
        engine.notifyDespawn(eid, objectRef);
        const x = position.x[eid];
        const y = position.y[eid];
        engine.emitEvent(new ObjectDeleteEvent(type.objectTypeId, objectRef, x, y));
        engine.emitMetrics(METRICS_ENTRY_TYPE_OBJECT_DESPAWNED, playerRef, type.objectTypeId, 1);
        // Before the destroy, which recycles the eid and may clear its position.
        this._unindexChunk(eid, x, y);
        engine.components.destroyEntity(eid);
        this._eidByObjectRef.delete(objectRef);
        engine.notifyChunkChanged(chunkKeyAt(x, y));
        return true;
    }

    /**
     * Records an eid under the chunk its position falls in.
     * @private
     * @param {number} eid
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    _indexChunk(eid, x, y) {
        const chunkKey = chunkKeyAt(x, y);
        const held = this._eidsByChunk.get(chunkKey);
        if (held === undefined) {
            this._eidsByChunk.set(chunkKey, new Set([eid]));
        } else {
            held.add(eid);
        }
    }

    /**
     * Drops an eid from its chunk, dropping the chunk once it empties.
     * @private
     * @param {number} eid
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    _unindexChunk(eid, x, y) {
        const chunkKey = chunkKeyAt(x, y);
        const held = this._eidsByChunk.get(chunkKey);
        if (held === undefined) {
            return;
        }
        held.delete(eid);
        if (held.size === 0) {
            this._eidsByChunk.delete(chunkKey);
        }
    }

    /**
     * The chunk's objects as one packed batch, or nothing when it holds none.
     * @param {number} chunkKey
     * @returns {ObjectSyncBatchEvent[]}
     */
    chunkSync(chunkKey) {
        const eids = this._eidsByChunk.get(chunkKey);
        if (eids === undefined) {
            return [];
        }
        const origin = chunkOrigin(chunkKey);
        let batch = null;
        const placedObject = this.objects.store;
        const position = this.engine.Position;
        for (const eid of eids) {
            const row = this.objects.getRowByEid(eid);
            const type = this._types.get(placedObject.objectTypeId[row]);
            if (batch === null) {
                batch = new ObjectSyncBatchEvent(origin.x, origin.y);
            }
            batch.add(
                type.objectTypeId, placedObject.objectRef[row], position.x[eid], position.y[eid], position.direction[eid],
                type.behavior.getRenderedPortEids(this.engine, eid),
            );
        }
        if (batch === null) {
            return [];
        }
        return [batch];
    }

    inspect(objectRef) {
        const eid = this._eidByObjectRef.get(objectRef);
        if (eid === undefined) {
            return null;
        }
        const type = this._types.get(this.getObjectTypeIdByEid(eid));
        if (!type.inspectable) {
            return null;
        }
        return type.behavior.inspect(this.engine, eid, objectRef);
    }

    /**
     * Rebuilds the objectRef index and every entity's rendered ports after a load, plus each behavior
     * class's derived indexes.
     * @returns {void}
     */
    rebuild() {
        this._eidByObjectRef = new Map();
        this._eidsByChunk = new Map();
        const placedObject = this.objects.store;
        const position = this.engine.Position;
        const eids = this.objects.eids;
        for (let row = 0; row < this.objects.count; row += 1) {
            const eid = eids[row];
            this._eidByObjectRef.set(placedObject.objectRef[row], eid);
            this._indexChunk(eid, position.x[eid], position.y[eid]);
            const type = this._types.get(placedObject.objectTypeId[row]);
            this.engine.ports.bindEndpoints(eid, type, position.x[eid], position.y[eid], position.direction[eid]);
            type.behavior.resyncRenderedPorts(this.engine, eid);
        }
        const rebuilt = new Set();
        for (const type of this._types.values()) {
            if (!rebuilt.has(type.behavior.constructor)) {
                rebuilt.add(type.behavior.constructor);
                type.behavior.onRebuild(this.engine);
            }
        }
    }
}
