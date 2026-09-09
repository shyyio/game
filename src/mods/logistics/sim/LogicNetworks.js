import {LOGIC_WIRE_RECORD} from "../common/constants.js";
import {LogicWireSetEvent, LogicWireClearEvent} from "../common/events.js";

/**
 * The canonical key of a wire.
 * @param {number} aObjectRef
 * @param {number} bObjectRef
 * @returns {string}
 */
function wireKey(aObjectRef, bObjectRef) {
    return `${Math.min(aObjectRef, bObjectRef)}:${Math.max(aObjectRef, bObjectRef)}`;
}

/**
 * One connected component of the logic network.
 */
export class LogicNetwork {

    /**
     * @param {number} id - the smallest member objectRef
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
         * The objectRefs of every placed pole (a lone pole is still its own component).
         * @type {Set<number>}
         */
        this._poles = new Set();
        /**
         * Wire key -> its {a, b} endpoint objectRefs.
         * @type {Map<string, {a: number, b: number}>}
         */
        this._wires = new Map();
        /**
         * Endpoint objectRef -> the wire keys touching it, so a despawn never walks every wire.
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
        this._poles.add(this.placed.objectRefOf(eid));
        this._dirty = true;
    }

    /**
     * Drops a despawned endpoint and every wire hanging off it.
     * @param {number} objectRef
     * @returns {void}
     */
    removeObject(objectRef) {
        const wasPole = this._poles.delete(objectRef);
        const keys = this._wiresByEndpoint.get(objectRef);
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
     * @param {number} aObjectRef
     * @param {number} bObjectRef
     * @returns {void}
     */
    wire(aObjectRef, bObjectRef) {
        const key = wireKey(aObjectRef, bObjectRef);
        if (this._wires.has(key)) {
            return;
        }
        this._hold(key, {a: aObjectRef, b: bObjectRef});
        this._dirty = true;
        this._emitAtEndpoints(LogicWireSetEvent, aObjectRef, bObjectRef);
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
        for (const objectRef of [wire.a, wire.b]) {
            const held = this._wiresByEndpoint.get(objectRef);
            if (held === undefined) {
                this._wiresByEndpoint.set(objectRef, new Set([key]));
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
        for (const objectRef of [wire.a, wire.b]) {
            const held = this._wiresByEndpoint.get(objectRef);
            held.delete(key);
            if (held.size === 0) {
                this._wiresByEndpoint.delete(objectRef);
            }
        }
        return true;
    }

    /**
     * Removes a wire; a missing wire is a no-op.
     * @param {number} aObjectRef
     * @param {number} bObjectRef
     * @returns {void}
     */
    unwire(aObjectRef, bObjectRef) {
        if (!this._drop(wireKey(aObjectRef, bObjectRef))) {
            return;
        }
        this._dirty = true;
        this._emitAtEndpoints(LogicWireClearEvent, aObjectRef, bObjectRef);
    }

    /**
     * @param {number} aObjectRef
     * @param {number} bObjectRef
     * @returns {boolean}
     */
    hasWire(aObjectRef, bObjectRef) {
        return this._wires.has(wireKey(aObjectRef, bObjectRef));
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
     * The network containing the pole or device with `objectRef`, or null.
     * @param {number} objectRef
     * @returns {LogicNetwork|null}
     */
    networkOf(objectRef) {
        for (const network of this.networks) {
            if (network.poleIds.includes(objectRef) || network.deviceIds.includes(objectRef)) {
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
     * @param {number} aObjectRef
     * @param {number} bObjectRef
     * @returns {void}
     */
    _emitAtEndpoints(eventClass, aObjectRef, bObjectRef) {
        const engine = this.engine;
        const position = engine.Position;
        const emitted = new Set();
        for (const objectRef of [aObjectRef, bObjectRef]) {
            const eid = this.placed.eidByObjectRef(objectRef);
            if (eid === undefined) {
                continue;
            }
            const event = new eventClass(position.x[eid], position.y[eid], aObjectRef, bObjectRef);
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
            if (this.placed.eidByObjectRef(wire.a) === undefined
                || this.placed.eidByObjectRef(wire.b) === undefined) {
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
        for (const objectRef of neighbors.keys()) {
            nodes.add(objectRef);
        }

        const componentByNode = new Map();
        const components = [];
        for (const seedObjectRef of nodes) {
            if (componentByNode.has(seedObjectRef)) {
                continue;
            }
            const members = [seedObjectRef];
            componentByNode.set(seedObjectRef, members);
            for (let at = 0; at < members.length; at += 1) {
                const held = neighbors.get(members[at]);
                if (held === undefined) {
                    continue;
                }
                for (const objectRef of held) {
                    if (!componentByNode.has(objectRef)) {
                        componentByNode.set(objectRef, members);
                        members.push(objectRef);
                    }
                }
            }
            components.push(members);
        }

        this._networks = components.map(members => {
            const sorted = [...members].sort((a, b) => a - b);
            const poleIds = sorted.filter(objectRef => this._poles.has(objectRef));
            const deviceIds = sorted.filter(objectRef => !this._poles.has(objectRef));
            return new LogicNetwork(sorted[0], poleIds, deviceIds);
        });
    }
}
