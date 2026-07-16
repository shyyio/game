import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent, ObjectSyncEvent, ObjectDeleteEvent} from "@/common/ObjectEvents.js";
import {chunkId} from "@/common/util.js";
import {NO_EID} from "@/common/sim/GameEngine.js";

/**
 * The generic entity host for every derived (behavior-driven) object type: the shared PlacedObject
 * component, the clientId -> eid index, and the ONE spawn/despawn/chunk-sync/inspect path. Built by
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
        this.def = engine.defineComponent("PlacedObject", [
            {name: "typeId"},
            {name: "clientId", fill: NO_EID},
            {name: "x"},
            {name: "y"},
            {name: "direction"},
        ]);
        this.PlacedObject = this.def.store;

        // typeId -> ObjectType, derived types only.
        this._types = new Map();
        this._eidByClientId = new Map();

        const installed = new Set();
        registry.objectTypes.forEach(type => {
            if (type.behavior === null) {
                return;
            }
            this._types.set(type.typeId, type);
            if (!installed.has(type.behavior.constructor)) {
                installed.add(type.behavior.constructor);
                type.behavior.install(engine, this);
            }
        });

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
        return this._types.get(typeId).behavior;
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
     * The placed entity with client id `clientId`, or undefined.
     * @param {number} clientId
     * @returns {number|undefined}
     */
    eidByClientId(clientId) {
        return this._eidByClientId.get(clientId);
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
     * The generic spawn path: footprint/occupancy check (honoring placement.solid), the PlacedObject
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
        if (type.placement.solid && !engine.occupancyFree(footprint)) {
            return true;
        }
        const eid = engine.createEntity(this.def);
        const clientId = engine.createObjectId();
        const P = this.PlacedObject;
        P.typeId[eid] = type.typeId;
        P.clientId[eid] = clientId;
        P.x[eid] = message.x;
        P.y[eid] = message.y;
        P.direction[eid] = message.direction;
        const portIds = type.behavior.onSpawn(engine, this, eid, type, message);
        if (type.placement.solid) {
            engine.track(clientId, footprint);
        }
        this._eidByClientId.set(clientId, eid);
        engine.emitEvent(new ObjectInsertEvent(type.typeId, clientId, message.x, message.y, message.direction, portIds, null));
        return true;
    }

    /**
     * The generic despawn path; an index miss returns false (a bespoke type's delete falls through).
     * @private
     * @param {number} clientId
     * @returns {boolean}
     */
    _delete(clientId) {
        const eid = this._eidByClientId.get(clientId);
        if (eid === undefined) {
            return false;
        }
        const engine = this.engine;
        const P = this.PlacedObject;
        const type = this._types.get(P.typeId[eid]);
        type.behavior.onDespawn(engine, this, eid);
        engine.emitEvent(new ObjectDeleteEvent(type.typeId, clientId, P.x[eid], P.y[eid]));
        engine.destroyEntity(eid);
        this._eidByClientId.delete(clientId);
        return true;
    }

    /**
     * @private
     * @param {number} chunk
     * @returns {ObjectSyncEvent[]}
     */
    _chunkSync(chunk) {
        const events = [];
        const P = this.PlacedObject;
        this.engine.entitiesWith(this.def).forEach(eid => {
            if (chunkId(P.x[eid], P.y[eid]) !== chunk) {
                return;
            }
            const type = this._types.get(P.typeId[eid]);
            const sync = type.behavior.syncData(this.engine, this, eid);
            events.push(new ObjectSyncEvent(
                type.typeId, P.clientId[eid], P.x[eid], P.y[eid], P.direction[eid],
                sync.portIds, sync.lastOutput,
            ));
        });
        return events;
    }

    /**
     * @private
     * @param {number} objectId
     * @returns {InspectHeartbeatEvent|null}
     */
    _inspect(objectId) {
        const eid = this._eidByClientId.get(objectId);
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
     * Rebuilds the clientId index and every entity's rendered ports after a load, plus each behavior
     * class's derived indexes.
     * @private
     * @returns {void}
     */
    _rebuild() {
        this._eidByClientId = new Map();
        const P = this.PlacedObject;
        this.engine.entitiesWith(this.def).forEach(eid => {
            this._eidByClientId.set(P.clientId[eid], eid);
            const type = this._types.get(P.typeId[eid]);
            type.behavior.resyncRenderedPorts(this.engine, this, eid);
        });
        const rebuilt = new Set();
        this._types.forEach(type => {
            if (!rebuilt.has(type.behavior.constructor)) {
                rebuilt.add(type.behavior.constructor);
                type.behavior.onRebuild(this.engine, this);
            }
        });
    }
}
