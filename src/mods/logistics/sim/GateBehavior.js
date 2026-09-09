import {AbstractBehavior, TickPhase, EMPTY, NO_EID, LAYER_SURFACE, CONVEYS_ITEM, CONVEYS_FLUID, SyncedFields, SyncedField} from "@spup/sdk";
import {LOGIC_KEY_OPEN} from "../common/constants.js";
import {gateConnections, placementBlockedByGate} from "../common/gateConnections.js";

// Buffered toggles land first, then mode review, then the gate's own intents.
const ORDER_APPLY_PENDING = -30;
const ORDER_REVIEW = -20;

// No toggle buffered.
const PENDING_NONE = -1;

const SYNCED_FIELDS = new SyncedFields("Gate", [
    new SyncedField("open", 1),
    new SyncedField("fluid"),
    new SyncedField("lastOutput", EMPTY),
]);

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
        engine.components.define("Gate", [
            {name: "in", kind: "eid", defaultValue: NO_EID},
            {name: "out", kind: "eid", defaultValue: NO_EID},
            // Item mode's internal port; NO_EID in fluid mode.
            {name: "int", kind: "eid", defaultValue: NO_EID},
            {name: "open", defaultValue: 1},
            // Current mode, adopted from coupled transports (see _review).
            {name: "fluid"},
            // Fluid mode's one-unit buffer, EMPTY when empty.
            {name: "buffered", kind: "item", defaultValue: EMPTY},
            // The last fluid buffered, so a client placing a pipe knows what the gate carries.
            {name: "lastOutput", kind: "item", defaultValue: EMPTY},
            // Toggle request applied at the next tick; PENDING_NONE when idle.
            {name: "pendingOpen", defaultValue: PENDING_NONE},
        ], {sparse: true});
        engine.registerPlacementGuard((type, x, y, direction) => !placementBlockedByGate(
            (tx, ty) => GateBehavior._occupantAt(engine, tx, ty),
            occupant => occupant.type.behavior instanceof GateBehavior,
            type, x, y, direction,
        ));
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => GateBehavior._applyPending(engine), ORDER_APPLY_PENDING);
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => GateBehavior._review(engine), ORDER_REVIEW);
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => GateBehavior._submitIntents(engine));
        engine.registerSystem(TickPhase.POST_RESOLVE, () => GateBehavior._finish(engine));
    }

    onSpawn(engine, eid, type, message) {
        const def = engine.components.get("Gate");
        engine.components.attach(def, eid);
        const gate = def.store;
        const row = def.row(eid);
        gate.in[row] = engine.portFor(type.inputPorts[0], message.x, message.y, message.direction).port;
        gate.out[row] = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction).port;
        gate.open[row] = 1;
        const kinds = gateConnections(
            (tx, ty) => GateBehavior._occupantAt(engine, tx, ty),
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
        const def = engine.components.get("Gate");
        const gate = def.store;
        const row = def.row(eid);
        if (gate.fluid[row] === 1) {
            if (gate.open[row] === 1) {
                engine.ports.unmarkFluid(gate.in[row]);
            }
            engine.ports.unmarkFluid(gate.out[row]);
            // The port may outlive the gate (an adjacent pipe pins it); it no longer produces.
            engine.ports.setFluidSource(gate.out[row], EMPTY);
        } else {
            engine.render.unregisterPort(gate.out[row]);
        }
    }

    logicRead(engine, eid, key) {
        if (key !== LOGIC_KEY_OPEN) {
            return null;
        }
        const def = engine.components.get("Gate");
        return def.store.open[def.row(eid)];
    }

    logicWrite(engine, eid, key, value) {
        if (key !== LOGIC_KEY_OPEN) {
            return false;
        }
        this.requestOpen(engine, eid, value !== 0);
        return true;
    }

    logicReadKeys() {
        return [LOGIC_KEY_OPEN];
    }

    logicWriteKeys() {
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
        const def = engine.components.get("Gate");
        def.store.pendingOpen[def.row(eid)] = open ? 1 : 0;
    }

    /**
     * Sets a gate's open state, keeping fluid mode's in-port claim in step.
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
        const def = engine.components.get("Gate");
        const gate = def.store;
        const row = def.row(eid);
        const flag = open ? 1 : 0;
        if (gate.open[row] === flag) {
            return false;
        }
        gate.open[row] = flag;
        engine.sync.markDirty(def, eid);
        // Unmarking the closed in-port makes the upstream network's out-edge skip it.
        if (gate.fluid[row] === 1) {
            if (flag === 1) {
                engine.ports.markFluid(gate.in[row]);
            } else {
                engine.ports.unmarkFluid(gate.in[row]);
            }
        }
        return true;
    }

    renderedPortIds(engine, eid) {
        const def = engine.components.get("Gate");
        return [def.store.out[def.row(eid)]];
    }

    resyncRenderedPorts(engine, eid) {
        const def = engine.components.get("Gate");
        const gate = def.store;
        const row = def.row(eid);
        if (gate.fluid[row] === 1) {
            return;
        }
        const out = gate.out[row];
        engine.render.registerPort(out, engine.Position.x[out], engine.Position.y[out]);
    }

    /**
     * Restores the port fluid state after a load.
     * @param {GameEngine} engine
     * @returns {void}
     */
    onRebuild(engine) {
        const def = engine.components.get("Gate");
        const gate = def.store;
        for (let row = 0; row < def.count; row += 1) {
            if (gate.fluid[row] === 0) {
                continue;
            }
            if (gate.open[row] === 1) {
                engine.ports.markFluid(gate.in[row]);
            }
            engine.ports.markFluid(gate.out[row]);
            if (gate.buffered[row] !== EMPTY) {
                engine.ports.setFluidSource(gate.out[row], gate.buffered[row]);
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
    static _occupantAt(engine, x, y) {
        const placed = engine.placed;
        const objectId = engine.space.ownerAt(x, y, LAYER_SURFACE);
        if (objectId === null) {
            return null;
        }
        const eid = placed.eidByObjectId(objectId);
        if (eid === undefined) {
            return null;
        }
        const type = placed.typeFor(placed.objectTypeIdOf(eid));
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
        const def = engine.components.get("Gate");
        const gate = def.store;
        for (let row = 0; row < def.count; row += 1) {
            const pending = gate.pendingOpen[row];
            if (pending === PENDING_NONE) {
                continue;
            }
            gate.pendingOpen[row] = PENDING_NONE;
            GateBehavior._applyOpen(engine, def.eids[row], pending === 1);
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
        const def = engine.components.get("Gate");
        const gate = def.store;
        const position = engine.Position;
        for (let row = 0; row < def.count; row += 1) {
            const eid = def.eids[row];
            const kinds = gateConnections(
                (tx, ty) => GateBehavior._occupantAt(engine, tx, ty),
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
        const def = engine.components.get("Gate");
        const gate = def.store;
        const row = def.row(eid);
        engine.sync.markDirty(def, eid);
        engine.ports.setItem(gate.in[row], EMPTY);
        engine.ports.setItem(gate.out[row], EMPTY);
        if (fluid) {
            engine.ports.setItem(gate.int[row], EMPTY);
            gate.int[row] = NO_EID;
            engine.render.unregisterPort(gate.out[row]);
            gate.fluid[row] = 1;
            GateBehavior._enterFluidMode(engine, gate, row);
        } else {
            if (gate.open[row] === 1) {
                engine.ports.unmarkFluid(gate.in[row]);
            }
            engine.ports.unmarkFluid(gate.out[row]);
            engine.ports.setFluidSource(gate.out[row], EMPTY);
            gate.buffered[row] = EMPTY;
            gate.lastOutput[row] = EMPTY;
            gate.fluid[row] = 0;
            GateBehavior._enterItemMode(engine, gate, row);
        }
    }

    /**
     * Claims item mode's ports: a fresh internal port and the rendered out-port.
     * @private
     * @param {GameEngine} engine
     * @param {object} gate - the Gate component store
     * @param {number} row
     * @returns {void}
     */
    static _enterItemMode(engine, gate, row) {
        gate.int[row] = engine.ports.create();
        const out = gate.out[row];
        engine.render.registerPort(out, engine.Position.x[out], engine.Position.y[out]);
    }

    /**
     * Claims fluid mode's port flags; the closed in-port stays unmarked.
     * @private
     * @param {GameEngine} engine
     * @param {object} gate - the Gate component store
     * @param {number} row
     * @returns {void}
     */
    static _enterFluidMode(engine, gate, row) {
        if (gate.open[row] === 1) {
            engine.ports.markFluid(gate.in[row]);
        }
        engine.ports.markFluid(gate.out[row]);
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
        const def = engine.components.get("Gate");
        const gate = def.store;
        for (let row = 0; row < def.count; row += 1) {
            if (gate.open[row] === 0) {
                continue;
            }
            if (gate.fluid[row] === 1) {
                const resting = item[gate.in[row]];
                if (resting !== EMPTY && gate.buffered[row] === EMPTY) {
                    engine.transfers.submitDrain(gate.in[row]);
                    gate.buffered[row] = resting;
                    engine.ports.setFluidSource(gate.out[row], resting);
                    if (gate.lastOutput[row] !== resting) {
                        gate.lastOutput[row] = resting;
                        engine.sync.markDirty(def, def.eids[row]);
                    }
                }
                if (gate.buffered[row] !== EMPTY) {
                    engine.transfers.submitCreate(gate.out[row], gate.buffered[row], item[gate.out[row]] === EMPTY);
                }
                continue;
            }
            if (item[gate.in[row]] !== EMPTY) {
                engine.transfers.submitTransfer(gate.in[row], gate.int[row], item[gate.int[row]] === EMPTY);
            }
            if (item[gate.int[row]] !== EMPTY) {
                engine.transfers.submitTransfer(gate.int[row], gate.out[row], item[gate.out[row]] === EMPTY);
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
        const def = engine.components.get("Gate");
        const gate = def.store;
        for (let row = 0; row < def.count; row += 1) {
            if (gate.fluid[row] === 1 && gate.buffered[row] !== EMPTY && engine.transfers.wasDest(gate.out[row])) {
                gate.buffered[row] = EMPTY;
                engine.ports.setFluidSource(gate.out[row], EMPTY);
            }
        }
    }
}
