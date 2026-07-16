import {ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {ObjectInsertEvent, ObjectSyncEvent, ObjectDeleteEvent} from "@/common/ObjectEvents.js";

/**
 * The `data` payload of a derived-type cache entry.
 */
export class ObjectClientData {

    /**
     * @param {ObjectType} type
     * @param {Direction} direction
     */
    constructor(type, direction) {
        this.type = type;
        this.direction = direction;
    }
}

/**
 * The sole ClientCache writer for derived object types: first in the client's event dispatch, it
 * builds/removes cache entries from the generic object lifecycle events (bespoke types — belts —
 * keep writing their own entries from their own events) and tracks each object's position and last
 * produced item for the inspect panels.
 */
export class ClientCacheSync {

    /**
     * @param {ModRegistry} registry
     * @param {ClientCache} cache
     */
    constructor(registry, cache) {
        this._registry = registry;
        this._cache = cache;
        // Object id -> last produced item, for the inspect panel's output slot.
        this._lastProduced = new Map();
    }

    /**
     * The object's tile position (from its cache entry), for the inspect panel's connectors.
     * @param {number} objectId
     * @returns {{x:number, y:number}|undefined}
     */
    positionOf(objectId) {
        const entry = this._cache.get(objectId);
        return entry === null ? undefined : {x: entry.tileX, y: entry.tileY};
    }

    /**
     * @param {number} objectId
     * @returns {number|undefined}
     */
    lastProducedOf(objectId) {
        return this._lastProduced.get(objectId);
    }

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof ObjectInsertEvent || event instanceof ObjectSyncEvent) {
            this._set(event);
            return;
        }
        if (event instanceof ObjectDeleteEvent) {
            this._cache.remove(event.id);
            this._lastProduced.delete(event.id);
            return;
        }
        if (event instanceof ChunkUnsubscribeEvent) {
            // Evict only derived-type entries; bespoke mods (belts) evict their own.
            this._cache.getByChunk(event.chunk).forEach(entry => {
                if (entry.data instanceof ObjectClientData) {
                    this._cache.remove(entry.id);
                    this._lastProduced.delete(entry.id);
                }
            });
        }
    }

    /**
     * @private
     * @param {ObjectInsertEvent|ObjectSyncEvent} event
     * @returns {void}
     */
    _set(event) {
        const type = this._registry.typeById(event.typeId);
        const ports = {};
        type.outputPorts
            .filter(port => port.render)
            .forEach((port, i) => {
                ports[port.name] = event.portIds[i];
            });
        const cells = type.geometry.tiles(event.direction).map(cell => ({
            x: event.x + cell.x,
            y: event.y + cell.y,
            layer: type.occupancyLayer,
        }));
        this._cache.set(event.id, event.x, event.y, cells, ports, new ObjectClientData(type, event.direction));
        if (event.lastOutput !== null) {
            this._lastProduced.set(event.id, event.lastOutput);
        }
    }
}
