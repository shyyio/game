import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent, ObjectSyncEvent, ObjectDeleteEvent} from "@/common/ObjectEvents.js";
import {chunkId} from "@/common/util.js";
import {NO_EID} from "@/common/sim/GameEngine.js";

/**
 * The generic entity host for every derived (behavior-driven) object type: the shared PlacedObject
 * component, the objectId -> eid index, and the ONE spawn/despawn/chunk-sync/inspect path. Built by
 * the engine before sim mods wire up; installs each frozen type's behavior once per behavior class.
 * Types with `behavior: null` (belt) are ignored entirely — their bespoke sim mod owns them.
 */
export class PlacedObjects {

    /**
     * @param {GameEngine} engine
     * @param {ModRegistry} registry
     */
    constructor(engine, registry) {
        this.engine = engine;
        // Where a placed object sits lives on the shared Position component, not here.
        this.def = engine.defineComponent("PlacedObject", [
            {name: "typeId"},
            {name: "objectId", fill: NO_EID},
        ]);
        this.PlacedObject = this.def.store;

        // typeId -> ObjectType, derived types only.
        this._types = new Map();
        // typeId -> behavior, a dense array over the positional typeIds: the tick loops resolve a
        // behavior per entity per tick, so this stays off a Map lookup.
        this._behaviors = [];
        this._eidByObjectId = new Map();

        const installed = new Set();
        for (const type of registry.objectTypes) {
            if (type.behavior === null) {
                continue;
            }
            this._types.set(type.typeId, type);
            this._behaviors[type.typeId] = type.behavior;
            if (!installed.has(type.behavior.constructor)) {
                installed.add(type.behavior.constructor);
                type.behavior.install(engine, this);
            }
        }

        engine.registerMessageHandler(message => this._message(message));
        engine.registerChunkSync(chunk => this._chunkSync(chunk));
        engine.registerInspector(objectId => this._inspect(objectId));
        engine.registerRebuildHook(() => this._rebuild());
    }

    /**
     * The behavior instance owning `typeId`'s entities.
     * @param {number} typeId
     * @returns {AbstractBehavior}
     */
    behaviorFor(typeId) {
        return this._behaviors[typeId];
    }

    /**
     * The placed entities of one type.
     * @param {number} typeId
     * @returns {number[]}
     */
    eidsOf(typeId) {
        return this.engine.entitiesWith(this.def)
            .filter(eid => this.PlacedObject.typeId[eid] === typeId);
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
     * @private
     * @param {AbstractMessage} message
     * @returns {boolean}
     */
    _message(message) {
        if (message instanceof CreateObjectMessage) {
            return this._place(message);
        }
        if (message instanceof DeleteObjectMessage) {
            return this._delete(message.id);
        }
        return false;
    }

    /**
     * The generic spawn path: footprint/position check (honoring placement.solid), the PlacedObject
     * columns, the behavior's wiring, and the insert event. Returns false for types the host doesn't
     * own (bespoke placement falls through to the mod's own handler).
     * @private
     * @param {CreateObjectMessage} message
     * @returns {boolean}
     */
    _place(message) {
        const type = this._types.get(message.typeId);
        if (type === undefined) {
            return false;
        }
        const engine = this.engine;
        if (!type.behavior.canSpawn(engine, this, type, message)) {
            return true;
        }
        const footprint = engine.footprint(type, message.x, message.y, message.direction);
        if (type.placement.solid && !engine.cellsFree(footprint)) {
            return true;
        }
        const eid = engine.createEntity(this.def);
        const objectId = engine.createObjectId();
        const placedObject = this.PlacedObject;
        placedObject.typeId[eid] = type.typeId;
        placedObject.objectId[eid] = objectId;
        engine.setPosition(eid, message.x, message.y, message.direction);
        const portIds = type.behavior.onSpawn(engine, this, eid, type, message);
        if (type.placement.solid) {
            engine.track(objectId, footprint);
        }
        this._eidByObjectId.set(objectId, eid);
        engine.emitEvent(new ObjectInsertEvent(type.typeId, objectId, message.x, message.y, message.direction, portIds, null));
        return true;
    }

    /**
     * The generic despawn path; an index miss returns false (a bespoke type's delete falls through).
     * @private
     * @param {number} objectId
     * @returns {boolean}
     */
    _delete(objectId) {
        const eid = this._eidByObjectId.get(objectId);
        if (eid === undefined) {
            return false;
        }
        const engine = this.engine;
        const placedObject = this.PlacedObject;
        const position = engine.Position;
        const type = this._types.get(placedObject.typeId[eid]);
        type.behavior.onDespawn(engine, this, eid);
        engine.emitEvent(new ObjectDeleteEvent(type.typeId, objectId, position.x[eid], position.y[eid]));
        engine.destroyEntity(eid);
        this._eidByObjectId.delete(objectId);
        return true;
    }

    /**
     * @private
     * @param {number} chunk
     * @returns {ObjectSyncEvent[]}
     */
    _chunkSync(chunk) {
        const events = [];
        const placedObject = this.PlacedObject;
        const position = this.engine.Position;
        for (const eid of this.engine.entitiesWith(this.def)) {
            if (chunkId(position.x[eid], position.y[eid]) !== chunk) {
                continue;
            }
            const type = this._types.get(placedObject.typeId[eid]);
            const sync = type.behavior.syncData(this.engine, this, eid);
            events.push(new ObjectSyncEvent(
                type.typeId, placedObject.objectId[eid], position.x[eid], position.y[eid], position.direction[eid],
                sync.portIds, sync.lastOutput,
            ));
        }
        return events;
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
        const type = this._types.get(this.PlacedObject.typeId[eid]);
        if (!type.inspectable) {
            return null;
        }
        return type.behavior.inspect(this.engine, this, eid, objectId);
    }

    /**
     * Rebuilds the objectId index and every entity's rendered ports after a load, plus each behavior
     * class's derived indexes.
     * @private
     * @returns {void}
     */
    _rebuild() {
        this._eidByObjectId = new Map();
        const placedObject = this.PlacedObject;
        for (const eid of this.engine.entitiesWith(this.def)) {
            this._eidByObjectId.set(placedObject.objectId[eid], eid);
            const type = this._types.get(placedObject.typeId[eid]);
            type.behavior.resyncRenderedPorts(this.engine, this, eid);
        }
        const rebuilt = new Set();
        for (const type of this._types.values()) {
            if (!rebuilt.has(type.behavior.constructor)) {
                rebuilt.add(type.behavior.constructor);
                type.behavior.onRebuild(this.engine, this);
            }
        }
    }
}
