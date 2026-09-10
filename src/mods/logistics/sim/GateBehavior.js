import {AbstractBehavior, EMPTY, NO_EID, LAYER_SURFACE, CONVEYS_ITEM, CONVEYS_FLUID, SyncedFields, SyncedField, AbstractSystem} from "@spup/sdk";
import {LOGIC_KEY_OPEN} from "../common/constants.js";
import {gateConnections, isPlacementBlockedByGate} from "../common/gateConnections.js";
import {GateComponent, PENDING_NONE} from "./GateComponent.js";

const SYNCED_FIELDS = new SyncedFields("Gate", [
    new SyncedField("open", 1),
    new SyncedField("fluid"),
    new SyncedField("lastOutput", EMPTY),
]);

/**
 * Buffered toggles land first, then mode review, then the gate's own intents.
 */
class GateSystem extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        super();
        this.engine = engine;
    }

    submitIntents() {
        GateBehavior._applyPending(this.engine);
        GateBehavior._review(this.engine);
        GateBehavior._submitIntents(this.engine);
    }

    postResolve() {
        GateBehavior._finish(this.engine);
    }

    isPlacementAllowed(type, x, y, direction) {
        return !isPlacementBlockedByGate(
            (tx, ty) => GateBehavior._findOccupantAt(this.engine, tx, ty),
            occupant => occupant.type.behavior instanceof GateBehavior,
            type, x, y, direction,
        );
    }
}

/**
 * A player-toggled flow stop that adopts the kind of the transport coupled to it: item mode
 * routes in -> int -> out, fluid mode buffers one unit between the neighboring pipe networks.
 * Closed, it submits nothing and the upstream side backs up on its own.
 */
export class GateBehavior extends AbstractBehavior {

    get syncedFields() {
        return SYNCED_FIELDS;
    }

    install(engine) {
        engine.components.register(new GateComponent());
        engine.registerSystem(new GateSystem(engine));
    }

    onSpawn(engine, eid, type, message) {
        const gates = engine.components.getComponentByName("Gate");
        gates.attach(eid);
        const gate = gates.store;
        const row = gates.getRowByEid(eid);
        gate.inputPort[row] = engine.getPortAt(type.inputPorts[0], message.x, message.y, message.direction).port;
        gate.outputPort[row] = engine.getPortAt(type.outputPorts[0], message.x, message.y, message.direction).port;
        gate.open[row] = 1;
        const kinds = gateConnections(
            (tx, ty) => GateBehavior._findOccupantAt(engine, tx, ty),
            message.x, message.y, message.direction,
        );
        const wantsFluid = (kinds.behind === CONVEYS_FLUID || kinds.front === CONVEYS_FLUID)
            && kinds.behind !== CONVEYS_ITEM && kinds.front !== CONVEYS_ITEM;
        gate.fluid[row] = wantsFluid ? 1 : 0;
        if (wantsFluid) {
            GateBehavior._enterFluidMode(engine, gate, row);
        } else {
            GateBehavior._enterItemMode(engine, gate, row);
        }
    }

    onDespawn(engine, eid) {
        const gates = engine.components.getComponentByName("Gate");
        const gate = gates.store;
        const row = gates.getRowByEid(eid);
        if (gate.fluid[row] === 1) {
            if (gate.open[row] === 1) {
                engine.ports.unmarkFluid(gate.inputPort[row]);
            }
            engine.ports.unmarkFluid(gate.outputPort[row]);
            // The port may outlive the gate (an adjacent pipe pins it); it no longer produces.
            engine.ports.setFluidSource(gate.outputPort[row], EMPTY);
        } else {
            engine.render.unregisterPort(gate.outputPort[row]);
        }
    }

    logicRead(engine, eid, key) {
        if (key !== LOGIC_KEY_OPEN) {
            return null;
        }
        const gates = engine.components.getComponentByName("Gate");
        return gates.store.open[gates.getRowByEid(eid)];
    }

    logicWrite(engine, eid, key, value) {
        if (key !== LOGIC_KEY_OPEN) {
            return false;
        }
        this.requestOpen(engine, eid, value !== 0);
        return true;
    }

    getLogicReadKeys() {
        return [LOGIC_KEY_OPEN];
    }

    getLogicWriteKeys() {
        return [LOGIC_KEY_OPEN];
    }

    /**
     * Buffers a toggle; the next tick applies it.
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {boolean} open
     * @returns {void}
     */
    requestOpen(engine, eid, open) {
        const gates = engine.components.getComponentByName("Gate");
        gates.store.pendingOpen[gates.getRowByEid(eid)] = open ? 1 : 0;
    }

    /**
     * Sets a gate's open state, keeping fluid mode's input port claim in step.
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {boolean} open
     * @returns {boolean} whether the state changed
     */
    setOpen(engine, eid, open) {
        return GateBehavior._applyOpen(engine, eid, open);
    }

    /**
     * @private
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {boolean} open
     * @returns {boolean} whether the state changed
     */
    static _applyOpen(engine, eid, open) {
        const gates = engine.components.getComponentByName("Gate");
        const gate = gates.store;
        const row = gates.getRowByEid(eid);
        const flag = open ? 1 : 0;
        if (gate.open[row] === flag) {
            return false;
        }
        gate.open[row] = flag;
        engine.sync.markDirty(gates, eid);
        // Unmarking the closed input port makes the upstream network's out-edge skip it.
        if (gate.fluid[row] === 1) {
            if (flag === 1) {
                engine.ports.markFluid(gate.inputPort[row]);
            } else {
                engine.ports.unmarkFluid(gate.inputPort[row]);
            }
        }
        return true;
    }

    getRenderedPortEids(engine, eid) {
        const gates = engine.components.getComponentByName("Gate");
        return [gates.store.outputPort[gates.getRowByEid(eid)]];
    }

    resyncRenderedPorts(engine, eid) {
        const gates = engine.components.getComponentByName("Gate");
        const gate = gates.store;
        const row = gates.getRowByEid(eid);
        if (gate.fluid[row] === 1) {
            return;
        }
        const out = gate.outputPort[row];
        engine.render.registerPort(out, engine.Position.x[out], engine.Position.y[out]);
    }

    /**
     * Restores the port fluid state after a load.
     * @param {GameEngine} engine
     * @returns {void}
     */
    onRebuild(engine) {
        const gates = engine.components.getComponentByName("Gate");
        const gate = gates.store;
        for (let row = 0; row < gates.count; row += 1) {
            if (gate.fluid[row] === 0) {
                continue;
            }
            if (gate.open[row] === 1) {
                engine.ports.markFluid(gate.inputPort[row]);
            }
            engine.ports.markFluid(gate.outputPort[row]);
            if (gate.buffered[row] !== EMPTY) {
                engine.ports.setFluidSource(gate.outputPort[row], gate.buffered[row]);
            }
        }
    }

    /**
     * The SURFACE occupant at (x, y) as the connection rules see it, or null.
     * @private
     * @param {GameEngine} engine
     * @param {number} x
     * @param {number} y
     * @returns {{type: ObjectType, direction: Direction}|null}
     */
    static _findOccupantAt(engine, x, y) {
        const placed = engine.placed;
        const objectRef = engine.space.getOwnerAt(x, y, LAYER_SURFACE);
        if (objectRef === null) {
            return null;
        }
        const eid = placed.findEidByObjectRef(objectRef);
        if (eid === undefined) {
            return null;
        }
        const type = placed.getObjectTypeByTypeId(placed.getObjectTypeIdByEid(eid));
        if (type === undefined) {
            return null;
        }
        return {type, direction: engine.Position.direction[eid]};
    }

    /**
     * SUBMIT_INTENTS (first): applies the buffered toggles.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _applyPending(engine) {
        const gates = engine.components.getComponentByName("Gate");
        const gate = gates.store;
        for (let row = 0; row < gates.count; row += 1) {
            const pending = gate.pendingOpen[row];
            if (pending === PENDING_NONE) {
                continue;
            }
            gate.pendingOpen[row] = PENDING_NONE;
            GateBehavior._applyOpen(engine, gates.eids[row], pending === 1);
        }
    }

    /**
     * SUBMIT_INTENTS (before intents): adopts the mode of the coupled transports.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _review(engine) {
        const placed = engine.placed;
        const gates = engine.components.getComponentByName("Gate");
        const gate = gates.store;
        const position = engine.Position;
        for (let row = 0; row < gates.count; row += 1) {
            const eid = gates.eids[row];
            const kinds = gateConnections(
                (tx, ty) => GateBehavior._findOccupantAt(engine, tx, ty),
                position.x[eid], position.y[eid], position.direction[eid],
            );
            const hasItem = kinds.behind === CONVEYS_ITEM || kinds.front === CONVEYS_ITEM;
            const hasFluid = kinds.behind === CONVEYS_FLUID || kinds.front === CONVEYS_FLUID;
            let target = gate.fluid[row];
            if (hasFluid && !hasItem) {
                target = 1;
            } else if (hasItem && !hasFluid) {
                target = 0;
            }
            if (target !== gate.fluid[row]) {
                GateBehavior._setMode(engine, eid, target === 1);
            }
        }
    }

    /**
     * Flips a gate's mode, discarding stranded cargo.
     * @private
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {boolean} fluid
     * @returns {void}
     */
    static _setMode(engine, eid, fluid) {
        const gates = engine.components.getComponentByName("Gate");
        const gate = gates.store;
        const row = gates.getRowByEid(eid);
        engine.sync.markDirty(gates, eid);
        engine.ports.setItem(gate.inputPort[row], EMPTY);
        engine.ports.setItem(gate.outputPort[row], EMPTY);
        if (fluid) {
            engine.ports.setItem(gate.internalPort[row], EMPTY);
            gate.internalPort[row] = NO_EID;
            engine.render.unregisterPort(gate.outputPort[row]);
            gate.fluid[row] = 1;
            GateBehavior._enterFluidMode(engine, gate, row);
        } else {
            if (gate.open[row] === 1) {
                engine.ports.unmarkFluid(gate.inputPort[row]);
            }
            engine.ports.unmarkFluid(gate.outputPort[row]);
            engine.ports.setFluidSource(gate.outputPort[row], EMPTY);
            gate.buffered[row] = EMPTY;
            gate.lastOutput[row] = EMPTY;
            gate.fluid[row] = 0;
            GateBehavior._enterItemMode(engine, gate, row);
        }
    }

    /**
     * Claims item mode's ports: a fresh internal port and the rendered output port.
     * @private
     * @param {GameEngine} engine
     * @param {object} gate - the Gate component store
     * @param {number} row
     * @returns {void}
     */
    static _enterItemMode(engine, gate, row) {
        gate.internalPort[row] = engine.ports.create();
        const out = gate.outputPort[row];
        engine.render.registerPort(out, engine.Position.x[out], engine.Position.y[out]);
    }

    /**
     * Claims fluid mode's port flags; the closed input port stays unmarked.
     * @private
     * @param {GameEngine} engine
     * @param {object} gate - the Gate component store
     * @param {number} row
     * @returns {void}
     */
    static _enterFluidMode(engine, gate, row) {
        if (gate.open[row] === 1) {
            engine.ports.markFluid(gate.inputPort[row]);
        }
        engine.ports.markFluid(gate.outputPort[row]);
    }

    /**
     * SUBMIT_INTENTS: item mode links in -> int -> out; fluid mode drains into the buffer and
     * creates out of it. Closed gates submit nothing.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _submitIntents(engine) {
        const item = engine.Port.item;
        const gates = engine.components.getComponentByName("Gate");
        const gate = gates.store;
        for (let row = 0; row < gates.count; row += 1) {
            if (gate.open[row] === 0) {
                continue;
            }
            if (gate.fluid[row] === 1) {
                const resting = item[gate.inputPort[row]];
                if (resting !== EMPTY && gate.buffered[row] === EMPTY) {
                    engine.transfers.submitDrain(gate.inputPort[row]);
                    gate.buffered[row] = resting;
                    engine.ports.setFluidSource(gate.outputPort[row], resting);
                    if (gate.lastOutput[row] !== resting) {
                        gate.lastOutput[row] = resting;
                        engine.sync.markDirty(gates, gates.eids[row]);
                    }
                }
                if (gate.buffered[row] !== EMPTY) {
                    engine.transfers.submitCreate(gate.outputPort[row], gate.buffered[row], item[gate.outputPort[row]] === EMPTY);
                }
                continue;
            }
            if (item[gate.inputPort[row]] !== EMPTY) {
                engine.transfers.submitTransfer(gate.inputPort[row], gate.internalPort[row], item[gate.internalPort[row]] === EMPTY);
            }
            if (item[gate.internalPort[row]] !== EMPTY) {
                engine.transfers.submitTransfer(gate.internalPort[row], gate.outputPort[row], item[gate.outputPort[row]] === EMPTY);
            }
        }
    }

    /**
     * POST_RESOLVE: a fluid gate whose buffered unit was delivered debits its buffer.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _finish(engine) {
        const gates = engine.components.getComponentByName("Gate");
        const gate = gates.store;
        for (let row = 0; row < gates.count; row += 1) {
            if (gate.fluid[row] === 1 && gate.buffered[row] !== EMPTY && engine.transfers.isDest(gate.outputPort[row])) {
                gate.buffered[row] = EMPTY;
                engine.ports.setFluidSource(gate.outputPort[row], EMPTY);
            }
        }
    }
}
