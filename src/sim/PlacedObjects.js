import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent, ObjectDeleteEvent, ObjectSyncBatchEvent} from "@/common/ObjectEvents.js";
import {Direction, PLAYER_ID_NONE} from "@/common/constants.js";
import {chunkId, chunkOrigin} from "@/common/util.js";
import {NO_EID} from "@/sim/sentinels.js";
import {METRICS_FACT_TYPE_OBJECT_PLACED, METRICS_FACT_TYPE_OBJECT_DESPAWNED} from "@/common/MetricsFact.js";

const EMPTY_EIDS = new Set();

/**
 * The generic entity host for every derived (behavior-driven) object type: the shared PlacedObject
 * component, the objectId -> eid index, and the ONE spawn/despawn/chunk-sync/inspect path. Built by
 * the engine before sim mods wire up; installs each frozen type's behavior once per behavior class.
 */
export class PlacedObjects {

    /**
     * @param {GameEngine} engine
     * @param {ModRegistry} registry
     */
    constructor(engine, registry) {
        this.engine = engine;
        // Where a placed object sits lives on the shared Position component, not here.
        this.def = engine.components.define("PlacedObject", [
            {name: "objectTypeId", kind: "type"},
            {name: "objectId", defaultValue: NO_EID},
            // Who placed it, for record keeping: a friend building in your chunk is recorded as
            // themselves. Economics read claimOwnerOf instead, which follows the ground.
            {name: "placedBy", defaultValue: PLAYER_ID_NONE},
        ], {sparse: true});

        // objectTypeId -> ObjectType, derived types only.
        this._types = new Map();
        // objectTypeId -> behavior, a dense array over the positional objectTypeIds: the tick loops resolve a
        // behavior per entity per tick, so this stays off a Map lookup.
        this._behaviors = [];
        this._eidByObjectId = new Map();
        // Chunk -> the eids placed in it, so a subscribing session syncs a chunk without a scan of
        // every placed object in the world.
        this._eidsByChunk = new Map();
        // Called with a chunk ordinal after any spawn/despawn in it (the overworld bake repaints).
        this._chunkObservers = [];

        // Before the behavior installs, so anything a behavior registers (a belt path sync) runs
        // after the host's — the client rebuilds objects first, then what references them.
        engine.registerMessageHandler((message, playerId) => this._message(message, playerId));
        engine.registerChunkSync(chunk => this._chunkSync(chunk));
        engine.registerInspector(objectId => this._inspect(objectId));
        engine.snapshots.registerRebuildHook(() => this._rebuild());

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
                    this.engine.sync.register(this.engine.components.get(synced.component), synced.fields);
                }
            }
        }
    }

    /**
     * The type of a placed entity.
     * @param {number} eid
     * @returns {number}
     */
    objectTypeIdOf(eid) {
        return this.def.store.objectTypeId[this.def.row(eid)];
    }

    /**
     * The client-facing object id of a placed entity.
     * @param {number} eid
     * @returns {number}
     */
    objectIdOf(eid) {
        return this.def.store.objectId[this.def.row(eid)];
    }

    /**
     * The player who placed this entity, PLAYER_ID_NONE for an engine-originated spawn.
     * @param {number} eid
     * @returns {number}
     */
    placedByOf(eid) {
        return this.def.store.placedBy[this.def.row(eid)];
    }

    /**
     * The current owner of the chunk this entity stands in, PLAYER_ID_NONE when unclaimed. Read live
     * rather than cached: a stored copy would have to be rewritten at every claim and permission
     * change, and a missed call site bills the wrong player.
     * @param {number} eid
     * @returns {number}
     */
    claimOwnerOf(eid) {
        const position = this.engine.Position;
        return this.engine.chunkOwnerOf(chunkId(position.x[eid], position.y[eid]));
    }

    /**
     * The behavior instance owning `objectTypeId`'s entities.
     * @param {number} objectTypeId
     * @returns {AbstractBehavior}
     */
    behaviorFor(objectTypeId) {
        return this._behaviors[objectTypeId];
    }

    /**
     * The ObjectType with `objectTypeId`, derived types only.
     * @param {number} objectTypeId
     * @returns {ObjectType|undefined}
     */
    typeFor(objectTypeId) {
        return this._types.get(objectTypeId);
    }

    /**
     * The placed entities of one type.
     * @param {number} objectTypeId
     * @returns {number[]}
     */
    eidsOf(objectTypeId) {
        const column = this.def.store.objectTypeId;
        const eids = this.def.eids;
        const matches = [];
        for (let row = 0; row < this.def.count; row += 1) {
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
    eidAt(tileX, tileY, layer) {
        const objectId = this.engine.space.ownerAt(tileX, tileY, layer);
        if (objectId === null) {
            return NO_EID;
        }
        const eid = this._eidByObjectId.get(objectId);
        if (eid === undefined) {
            throw new Error(`Cell ${tileX},${tileY} on layer ${layer} is owned by unknown object ${objectId}`);
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
    spawn({objectTypeId, tileX, tileY, direction, placedBy = PLAYER_ID_NONE}) {
        const message = new CreateObjectMessage(objectTypeId, tileX, tileY, direction);
        this._place(message, placedBy);
        const type = this._types.get(objectTypeId);
        if (type === undefined) {
            return NO_EID;
        }
        return this.eidAt(tileX, tileY, type.positionLayerTiles(message.direction)[0].layer);
    }

    /**
     * Removes a placed object as the engine rather than a player.
     * @param {number} eid
     * @returns {void}
     */
    despawn(eid) {
        const objectId = this.objectIdOf(eid);
        this.engine.untrack(objectId);
        this._delete(objectId, PLAYER_ID_NONE);
        this.engine.ports.collectUnreferenced();
    }

    /**
     * The placed entity with object id `objectId`, or undefined.
     * @param {number} objectId
     * @returns {number|undefined}
     */
    eidByObjectId(objectId) {
        return this._eidByObjectId.get(objectId);
    }

    /**
     * The eids placed in a chunk.
     * @param {number} chunk
     * @returns {Set<number>}
     */
    eidsInChunk(chunk) {
        const held = this._eidsByChunk.get(chunk);
        if (held === undefined) {
            return EMPTY_EIDS;
        }
        return held;
    }

    /**
     * Registers an observer called with a chunk ordinal after any spawn/despawn in it.
     * @param {function(number): void} observer
     * @returns {void}
     */
    registerChunkObserver(observer) {
        this._chunkObservers.push(observer);
    }

    /**
     * @private
     * @param {number} chunk
     * @returns {void}
     */
    _notifyChunkChanged(chunk) {
        for (const observer of this._chunkObservers) {
            observer(chunk);
        }
    }

    /**
     * @private
     * @param {AbstractMessage} message
     * @param {number} playerId
     * @returns {boolean}
     */
    _message(message, playerId) {
        if (message instanceof CreateObjectMessage) {
            return this._place(message, playerId);
        }
        if (message instanceof DeleteObjectMessage) {
            return this._delete(message.id, playerId);
        }
        return false;
    }

    /**
     * The generic spawn path: footprint/position check (honoring placement.solid), the PlacedObject
     * columns, the behavior's wiring, and the insert event. Returns false for types the host doesn't
     * own (bespoke placement falls through to the mod's own handler).
     * @private
     * @param {CreateObjectMessage} message
     * @param {number} playerId
     * @returns {boolean}
     */
    _place(message, playerId) {
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
        if (type.geometry.spansChunks(message.x, message.y, message.direction)) {
            return true;
        }
        if (!type.behavior.canSpawn(engine, type, message)) {
            return true;
        }
        if (!engine.placementGuardsAllow(type, message.x, message.y, message.direction)) {
            return true;
        }
        const footprint = engine.footprint(type, message.x, message.y, message.direction);
        if (type.placement.solid && !engine.space.cellsFree(footprint)) {
            return true;
        }
        const eid = engine.components.createEntity(this.def);
        const objectId = engine.createObjectId();
        const row = this.def.row(eid);
        this.def.store.objectTypeId[row] = type.objectTypeId;
        this.def.store.objectId[row] = objectId;
        this.def.store.placedBy[row] = playerId;
        engine.space.setPosition(eid, message.x, message.y, message.direction);
        engine.ports.bindEndpoints(eid, type, message.x, message.y, message.direction);
        type.behavior.onSpawn(engine, eid, type, message);
        const synced = type.behavior.syncedFields;
        if (synced !== null) {
            engine.sync.markSpawned(engine.components.get(synced.component), eid);
        }
        if (type.placement.solid) {
            engine.track(objectId, footprint);
        }
        this._eidByObjectId.set(objectId, eid);
        this._indexChunk(eid, message.x, message.y);
        this._notifyChunkChanged(chunkId(message.x, message.y));
        engine.notifySpawn(eid, objectId);
        const portIds = type.behavior.renderedPortIds(engine, eid);
        engine.emitEvent(new ObjectInsertEvent(type.objectTypeId, objectId, message.x, message.y, message.direction, portIds));
        engine.emitMetrics(METRICS_FACT_TYPE_OBJECT_PLACED, playerId, type.objectTypeId, 1);
        return true;
    }

    /**
     * The generic despawn path; an index miss returns false (a bespoke type's delete falls through).
     * @private
     * @param {number} objectId
     * @param {number} playerId
     * @returns {boolean}
     */
    _delete(objectId, playerId) {
        const eid = this._eidByObjectId.get(objectId);
        if (eid === undefined) {
            return false;
        }
        const engine = this.engine;
        const position = engine.Position;
        const type = this._types.get(this.objectTypeIdOf(eid));
        engine.ports.unbindEndpoints(eid);
        type.behavior.onDespawn(engine, eid);
        engine.notifyDespawn(eid, objectId);
        const x = position.x[eid];
        const y = position.y[eid];
        engine.emitEvent(new ObjectDeleteEvent(type.objectTypeId, objectId, x, y));
        engine.emitMetrics(METRICS_FACT_TYPE_OBJECT_DESPAWNED, playerId, type.objectTypeId, 1);
        // Before the destroy, which recycles the eid and may clear its position.
        this._unindexChunk(eid, x, y);
        engine.components.destroyEntity(eid);
        this._eidByObjectId.delete(objectId);
        this._notifyChunkChanged(chunkId(x, y));
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
        const chunk = chunkId(x, y);
        const held = this._eidsByChunk.get(chunk);
        if (held === undefined) {
            this._eidsByChunk.set(chunk, new Set([eid]));
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
        const chunk = chunkId(x, y);
        const held = this._eidsByChunk.get(chunk);
        if (held === undefined) {
            return;
        }
        held.delete(eid);
        if (held.size === 0) {
            this._eidsByChunk.delete(chunk);
        }
    }

    /**
     * The chunk's objects as one packed batch, or nothing when it holds none.
     * @private
     * @param {number} chunk
     * @returns {ObjectSyncBatchEvent[]}
     */
    _chunkSync(chunk) {
        const eids = this._eidsByChunk.get(chunk);
        if (eids === undefined) {
            return [];
        }
        const origin = chunkOrigin(chunk);
        let batch = null;
        const placedObject = this.def.store;
        const position = this.engine.Position;
        for (const eid of eids) {
            const row = this.def.row(eid);
            const type = this._types.get(placedObject.objectTypeId[row]);
            if (batch === null) {
                batch = new ObjectSyncBatchEvent(origin.x, origin.y);
            }
            batch.add(
                type.objectTypeId, placedObject.objectId[row], position.x[eid], position.y[eid], position.direction[eid],
                type.behavior.renderedPortIds(this.engine, eid),
            );
        }
        if (batch === null) {
            return [];
        }
        return [batch];
    }

    /**
     * @private
     * @param {number} objectId
     * @returns {InspectHeartbeatEvent|null}
     */
    _inspect(objectId) {
        const eid = this._eidByObjectId.get(objectId);
        if (eid === undefined) {
            return null;
        }
        const type = this._types.get(this.objectTypeIdOf(eid));
        if (!type.inspectable) {
            return null;
        }
        return type.behavior.inspect(this.engine, eid, objectId);
    }

    /**
     * Rebuilds the objectId index and every entity's rendered ports after a load, plus each behavior
     * class's derived indexes.
     * @private
     * @returns {void}
     */
    _rebuild() {
        this._eidByObjectId = new Map();
        this._eidsByChunk = new Map();
        const placedObject = this.def.store;
        const position = this.engine.Position;
        const eids = this.def.eids;
        for (let row = 0; row < this.def.count; row += 1) {
            const eid = eids[row];
            this._eidByObjectId.set(placedObject.objectId[row], eid);
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
