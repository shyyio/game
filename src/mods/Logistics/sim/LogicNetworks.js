import {LOGIC_WIRE_RECORD} from "../common/constants.js";
import {LogicWireSetEvent, LogicWireClearEvent} from "../common/events.js";

/**
 * The canonical key of a wire.
 * @param {number} aObjectId
 * @param {number} bObjectId
 * @returns {string}
 */
function wireKey(aObjectId, bObjectId) {
    return `${Math.min(aObjectId, bObjectId)}:${Math.max(aObjectId, bObjectId)}`;
}

/**
 * One connected component of the logic network.
 */
export class LogicNetwork {

    /**
     * @param {number} id - the smallest member objectId
     * @param {number[]} poleIds
     * @param {number[]} deviceIds
     */
    constructor(id, poleIds, deviceIds) {
        this.id = id;
        this.poleIds = poleIds;
        this.deviceIds = deviceIds;
    }
}

/**
 * The logic-network graph: every connection is an explicit wire between two wireable endpoints
 * (pole-pole, device-pole, or device-device). Components recompute lazily after any edit; edges
 * whose endpoint despawned are swept via the engine's despawn listener.
 */
export class LogicNetworks {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        this.engine = engine;
        this.placed = engine.placed;
        /**
         * The objectIds of every placed pole (a lone pole is still its own component).
         * @type {Set<number>}
         */
        this._poles = new Set();
        /**
         * Wire key -> its {a, b} endpoint objectIds.
         * @type {Map<string, {a: number, b: number}>}
         */
        this._wires = new Map();
        /**
         * Endpoint objectId -> the wire keys touching it, so a despawn never walks every wire.
         * @type {Map<number, Set<string>>}
         */
        this._wiresByEndpoint = new Map();
        this._networks = [];
        this._dirty = false;
    }

    /**
     * @param {number} eid
     * @returns {void}
     */
    addPole(eid) {
        this._poles.add(this.placed.objectIdOf(eid));
        this._dirty = true;
    }

    /**
     * Drops a despawned endpoint and every wire hanging off it.
     * @param {number} objectId
     * @returns {void}
     */
    removeObject(objectId) {
        const wasPole = this._poles.delete(objectId);
        const keys = this._wiresByEndpoint.get(objectId);
        if (keys !== undefined) {
            for (const key of [...keys]) {
                const wire = this._wires.get(key);
                this.unwire(wire.a, wire.b);
            }
        }
        // Most despawns are unrelated objects; leave the graph alone rather than force a re-flood.
        if (wasPole) {
            this._dirty = true;
        }
    }

    /**
     * Adds a wire between two endpoints; an existing wire is a no-op.
     * @param {number} aObjectId
     * @param {number} bObjectId
     * @returns {void}
     */
    wire(aObjectId, bObjectId) {
        const key = wireKey(aObjectId, bObjectId);
        if (this._wires.has(key)) {
            return;
        }
        this._hold(key, {a: aObjectId, b: bObjectId});
        this._dirty = true;
        this._emitAtEndpoints(LogicWireSetEvent, aObjectId, bObjectId);
    }

    /**
     * Records a wire in both the wire map and the endpoint index.
     * @private
     * @param {string} key
     * @param {{a: number, b: number}} wire
     * @returns {void}
     */
    _hold(key, wire) {
        this._wires.set(key, wire);
        for (const objectId of [wire.a, wire.b]) {
            const held = this._wiresByEndpoint.get(objectId);
            if (held === undefined) {
                this._wiresByEndpoint.set(objectId, new Set([key]));
            } else {
                held.add(key);
            }
        }
    }

    /**
     * Drops a wire from both the wire map and the endpoint index.
     * @private
     * @param {string} key
     * @returns {boolean} whether the wire was held
     */
    _drop(key) {
        const wire = this._wires.get(key);
        if (wire === undefined) {
            return false;
        }
        this._wires.delete(key);
        for (const objectId of [wire.a, wire.b]) {
            const held = this._wiresByEndpoint.get(objectId);
            held.delete(key);
            if (held.size === 0) {
                this._wiresByEndpoint.delete(objectId);
            }
        }
        return true;
    }

    /**
     * Removes a wire; a missing wire is a no-op.
     * @param {number} aObjectId
     * @param {number} bObjectId
     * @returns {void}
     */
    unwire(aObjectId, bObjectId) {
        if (!this._drop(wireKey(aObjectId, bObjectId))) {
            return;
        }
        this._dirty = true;
        this._emitAtEndpoints(LogicWireClearEvent, aObjectId, bObjectId);
    }

    /**
     * @param {number} aObjectId
     * @param {number} bObjectId
     * @returns {boolean}
     */
    hasWire(aObjectId, bObjectId) {
        return this._wires.has(wireKey(aObjectId, bObjectId));
    }

    /**
     * @returns {IterableIterator<{a: number, b: number}>}
     */
    get wires() {
        return this._wires.values();
    }

    /**
     * @returns {LogicNetwork[]}
     */
    get networks() {
        if (this._dirty) {
            this._recompute();
        }
        return this._networks;
    }

    /**
     * The network containing the pole or device with `objectId`, or null.
     * @param {number} objectId
     * @returns {LogicNetwork|null}
     */
    networkOf(objectId) {
        for (const network of this.networks) {
            if (network.poleIds.includes(objectId) || network.deviceIds.includes(objectId)) {
                return network;
            }
        }
        return null;
    }

    /**
     * Re-registers every placed pole after a load; the wires arrive through deserializeRecords.
     * @returns {void}
     */
    reset() {
        this._poles.clear();
        this._wires.clear();
        this._wiresByEndpoint.clear();
        this._networks = [];
        this._dirty = true;
    }

    /**
     * @returns {object[]}
     */
    serializeRecords() {
        const rows = [...this._wires.values()].map(wire => ({a_object_id: wire.a, b_object_id: wire.b}));
        return [{
            name: LOGIC_WIRE_RECORD,
            fields: [
                {name: "a_object_id", kind: "integer"},
                {name: "b_object_id", kind: "integer"},
            ],
            rows,
        }];
    }

    /**
     * @param {object|undefined} table
     * @returns {void}
     */
    deserializeRecords(table) {
        if (table === undefined) {
            return;
        }
        for (const row of table.rows) {
            this._hold(wireKey(row.a_object_id, row.b_object_id), {a: row.a_object_id, b: row.b_object_id});
        }
        this._dirty = true;
    }

    /**
     * Emits one wire event per distinct endpoint chunk, so both sides' viewers hear it.
     * @private
     * @param {Function} eventClass
     * @param {number} aObjectId
     * @param {number} bObjectId
     * @returns {void}
     */
    _emitAtEndpoints(eventClass, aObjectId, bObjectId) {
        const engine = this.engine;
        const position = engine.Position;
        const emitted = new Set();
        for (const objectId of [aObjectId, bObjectId]) {
            const eid = this.placed.eidByObjectId(objectId);
            if (eid === undefined) {
                continue;
            }
            const event = new eventClass(position.x[eid], position.y[eid], aObjectId, bObjectId);
            if (emitted.has(event.chunk)) {
                continue;
            }
            emitted.add(event.chunk);
            engine.emitEvent(event);
        }
    }

    /**
     * Full flood-fill over the wires. Nodes are the wire endpoints plus every pole; an edge with
     * a dead endpoint is dropped here.
     * @private
     * @returns {void}
     */
    _recompute() {
        this._dirty = false;
        const neighbors = new Map();
        for (const [key, wire] of [...this._wires]) {
            if (this.placed.eidByObjectId(wire.a) === undefined
                || this.placed.eidByObjectId(wire.b) === undefined) {
                this._drop(key);
                continue;
            }
            const heldA = neighbors.get(wire.a);
            if (heldA === undefined) {
                neighbors.set(wire.a, [wire.b]);
            } else {
                heldA.push(wire.b);
            }
            const heldB = neighbors.get(wire.b);
            if (heldB === undefined) {
                neighbors.set(wire.b, [wire.a]);
            } else {
                heldB.push(wire.a);
            }
        }
        const nodes = new Set(this._poles);
        for (const objectId of neighbors.keys()) {
            nodes.add(objectId);
        }

        const componentByNode = new Map();
        const components = [];
        for (const seedObjectId of nodes) {
            if (componentByNode.has(seedObjectId)) {
                continue;
            }
            const members = [seedObjectId];
            componentByNode.set(seedObjectId, members);
            for (let at = 0; at < members.length; at += 1) {
                const held = neighbors.get(members[at]);
                if (held === undefined) {
                    continue;
                }
                for (const objectId of held) {
                    if (!componentByNode.has(objectId)) {
                        componentByNode.set(objectId, members);
                        members.push(objectId);
                    }
                }
            }
            components.push(members);
        }

        this._networks = components.map(members => {
            const sorted = [...members].sort((a, b) => a - b);
            const poleIds = sorted.filter(objectId => this._poles.has(objectId));
            const deviceIds = sorted.filter(objectId => !this._poles.has(objectId));
            return new LogicNetwork(sorted[0], poleIds, deviceIds);
        });
    }
}
