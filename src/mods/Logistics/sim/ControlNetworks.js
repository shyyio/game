import {POLE_NONE, CONTROL_WIRE_RECORD} from "../common/constants.js";
import {
    ControlLinkSetEvent,
    ControlLinkClearEvent,
    ControlWireSetEvent,
    ControlWireClearEvent,
} from "../common/events.js";

/**
 * The canonical key of a pole-pole wire.
 * @param {number} aObjectId
 * @param {number} bObjectId
 * @returns {string}
 */
function wireKey(aObjectId, bObjectId) {
    return `${Math.min(aObjectId, bObjectId)}:${Math.max(aObjectId, bObjectId)}`;
}

/**
 * One connected component of the control network.
 */
export class ControlNetwork {

    /**
     * @param {number} id - the smallest member pole's objectId
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
 * The control-network graph: every connection is an explicit wire — pole-pole edges in the wire
 * set, devices through the ControlLink component. Components recompute lazily after any edit.
 */
export class ControlNetworks {

    /**
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     */
    constructor(engine, placed) {
        this.engine = engine;
        this.placed = placed;
        /**
         * Pole eid -> its objectId.
         * @type {Map<number, number>}
         */
        this._poles = new Map();
        /**
         * Wire key -> its {a, b} pole objectIds.
         * @type {Map<string, {a: number, b: number}>}
         */
        this._wires = new Map();
        this._networks = [];
        this._dirty = false;
    }

    /**
     * @param {number} eid
     * @returns {void}
     */
    addPole(eid) {
        this._poles.set(eid, this.placed.objectIdOf(eid));
        this._dirty = true;
    }

    /**
     * Removes a pole and clears every wire hanging off it.
     * @param {number} eid
     * @returns {void}
     */
    removePole(eid) {
        const poleObjectId = this._poles.get(eid);
        this._poles.delete(eid);
        this._dirty = true;
        for (const wire of [...this._wires.values()]) {
            if (wire.a === poleObjectId || wire.b === poleObjectId) {
                this.unwirePoles(wire.a, wire.b);
            }
        }
        const def = this.engine.component("ControlLink");
        const link = def.store;
        for (let row = 0; row < def.count; row += 1) {
            if (link.pole[row] === poleObjectId) {
                this._clearRow(def, row);
            }
        }
    }

    /**
     * Adds a pole-pole wire; an existing wire is a no-op.
     * @param {number} aObjectId
     * @param {number} bObjectId
     * @returns {void}
     */
    wirePoles(aObjectId, bObjectId) {
        const key = wireKey(aObjectId, bObjectId);
        if (this._wires.has(key)) {
            return;
        }
        this._wires.set(key, {a: aObjectId, b: bObjectId});
        this._dirty = true;
        this._emitAtEndpoints(ControlWireSetEvent, aObjectId, bObjectId);
    }

    /**
     * Removes a pole-pole wire; a missing wire is a no-op.
     * @param {number} aObjectId
     * @param {number} bObjectId
     * @returns {void}
     */
    unwirePoles(aObjectId, bObjectId) {
        if (!this._wires.delete(wireKey(aObjectId, bObjectId))) {
            return;
        }
        this._dirty = true;
        this._emitAtEndpoints(ControlWireClearEvent, aObjectId, bObjectId);
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
     * Wires a device to a pole, replacing any existing wire.
     * @param {number} deviceEid
     * @param {number} poleObjectId
     * @returns {void}
     */
    link(deviceEid, poleObjectId) {
        const engine = this.engine;
        const def = engine.component("ControlLink");
        if (def.row(deviceEid) < 0) {
            engine.attachComponent(def, deviceEid);
        }
        const row = def.row(deviceEid);
        if (def.store.pole[row] === poleObjectId) {
            return;
        }
        def.store.pole[row] = poleObjectId;
        this._dirty = true;
        const position = engine.Position;
        engine.emitEvent(new ControlLinkSetEvent(
            position.x[deviceEid],
            position.y[deviceEid],
            this.placed.objectIdOf(deviceEid),
            poleObjectId,
        ));
    }

    /**
     * Removes a device's wire; a wireless device is a no-op.
     * @param {number} deviceEid
     * @returns {void}
     */
    unlink(deviceEid) {
        const def = this.engine.component("ControlLink");
        const row = def.row(deviceEid);
        if (row < 0 || def.store.pole[row] === POLE_NONE) {
            return;
        }
        this._clearRow(def, row);
    }

    /**
     * The pole objectId a device is wired to, or POLE_NONE.
     * @param {number} deviceEid
     * @returns {number}
     */
    poleOf(deviceEid) {
        const def = this.engine.component("ControlLink");
        const row = def.row(deviceEid);
        if (row < 0) {
            return POLE_NONE;
        }
        return def.store.pole[row];
    }

    /**
     * @returns {ControlNetwork[]}
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
     * @returns {ControlNetwork|null}
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
     * Re-registers every placed pole after a load; ControlLink rows persist on their own.
     * @returns {void}
     */
    reset() {
        this._poles.clear();
        this._wires.clear();
        this._networks = [];
        this._dirty = true;
    }

    /**
     * @returns {object[]}
     */
    serializeRecords() {
        const rows = [...this._wires.values()].map(wire => ({a_object_id: wire.a, b_object_id: wire.b}));
        return [{
            name: CONTROL_WIRE_RECORD,
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
            this._wires.set(wireKey(row.a_object_id, row.b_object_id), {a: row.a_object_id, b: row.b_object_id});
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
     * Zeroes a link row and fans the removal out.
     * @private
     * @param {object} def - the ControlLink component
     * @param {number} row
     * @returns {void}
     */
    _clearRow(def, row) {
        def.store.pole[row] = POLE_NONE;
        this._dirty = true;
        const eid = def.eids[row];
        const position = this.engine.Position;
        this.engine.emitEvent(new ControlLinkClearEvent(
            position.x[eid],
            position.y[eid],
            this.placed.objectIdOf(eid),
        ));
    }

    /**
     * Full flood-fill over the explicit pole-pole wires, then device attachment.
     * @private
     * @returns {void}
     */
    _recompute() {
        this._dirty = false;
        const engine = this.engine;
        const neighbors = new Map();
        for (const wire of this._wires.values()) {
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
        const componentByPole = new Map();
        const components = [];
        for (const seedObjectId of this._poles.values()) {
            if (componentByPole.has(seedObjectId)) {
                continue;
            }
            const members = [{objectId: seedObjectId}];
            componentByPole.set(seedObjectId, members);
            for (let at = 0; at < members.length; at += 1) {
                const held = neighbors.get(members[at].objectId);
                if (held === undefined) {
                    continue;
                }
                for (const objectId of held) {
                    if (!componentByPole.has(objectId)) {
                        componentByPole.set(objectId, members);
                        members.push({objectId});
                    }
                }
            }
            components.push(members);
        }

        const devicesByPole = new Map();
        const def = engine.component("ControlLink");
        const link = def.store;
        for (let row = 0; row < def.count; row += 1) {
            if (link.pole[row] === POLE_NONE) {
                continue;
            }
            const deviceId = this.placed.objectIdOf(def.eids[row]);
            const held = devicesByPole.get(link.pole[row]);
            if (held === undefined) {
                devicesByPole.set(link.pole[row], [deviceId]);
            } else {
                held.push(deviceId);
            }
        }

        this._networks = components.map(members => {
            const poleIds = members.map(pole => pole.objectId).sort((a, b) => a - b);
            const deviceIds = poleIds.flatMap(poleId => {
                const held = devicesByPole.get(poleId);
                if (held === undefined) {
                    return [];
                }
                return held;
            }).sort((a, b) => a - b);
            return new ControlNetwork(poleIds[0], poleIds, deviceIds);
        });
    }
}
