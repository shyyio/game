import {AbstractBehavior, TickPhase, EMPTY, NO_EID, chunkId, getOrCreate, LAYER_SURFACE, CONVEYS_ITEM, CONVEYS_FLUID} from "@spup/sdk";
import {ORDER_BEFORE_TRANSPORT, LOGIC_KEY_OPEN} from "../common/constants.js";
import {GateSetBatchEvent} from "../common/events.js";
import {gateConnections, placementBlockedByGate} from "../common/gateConnections.js";

// Buffered toggles land first, then mode review, then the gate's own intents.
const ORDER_APPLY_PENDING = -30;
const ORDER_REVIEW = -20;
// Delta emission runs after the seam settled the tick's port moves.
const ORDER_EMIT = 10;

// No toggle buffered.
const PENDING_NONE = -1;

/**
 * A player-toggled flow stop that adopts the kind of the transport coupled to it: item mode
 * routes in -> int -> out, fluid mode buffers one unit between the neighboring pipe networks.
 * Closed, it submits nothing and the upstream side backs up on its own.
 */
export class GateBehavior extends AbstractBehavior {

    install(engine, placed) {
        engine.components.define("Gate", [
            {name: "in", kind: "eid", fill: NO_EID},
            {name: "out", kind: "eid", fill: NO_EID},
            // Item mode's internal port; NO_EID in fluid mode.
            {name: "int", kind: "eid", fill: NO_EID},
            {name: "open"},
            // Current mode, adopted from coupled transports (see _review).
            {name: "fluid"},
            // Fluid mode's one-unit buffer, EMPTY when empty.
            {name: "buffered", fill: EMPTY},
            // Toggle request applied at the next tick; PENDING_NONE when idle.
            {name: "pendingOpen", fill: PENDING_NONE},
            // Last state synced, so the tick emits only changes.
            {name: "lastOpen", fill: 1},
            {name: "lastFluid"},
        ], {sparse: true});
        engine.registerPlacementGuard((type, x, y, direction) => !placementBlockedByGate(
            (tx, ty) => GateBehavior._occupantAt(engine, placed, tx, ty),
            occupant => occupant.type.behavior instanceof GateBehavior,
            type, x, y, direction,
        ));
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => GateBehavior._applyPending(engine), ORDER_APPLY_PENDING);
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => GateBehavior._review(engine, placed), ORDER_REVIEW);
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => GateBehavior._submitIntents(engine));
        // Seam must read shared ports before the belt transport writes pops.
        const outputFills = [];
        engine.registerSystem(TickPhase.POST_RESOLVE, () => GateBehavior._runSeam(engine, outputFills), ORDER_BEFORE_TRANSPORT);
        engine.registerSystem(TickPhase.POST_RESOLVE, () => GateBehavior._emitDeltas(engine, placed), ORDER_EMIT);
        // Out-ports fill after the transport ingested, so a passed item rests a visible tick.
        engine.registerSystem(TickPhase.PRODUCE_OUTPUTS, () => GateBehavior._fillOutputs(engine, outputFills));
        engine.registerChunkSync(chunk => GateBehavior._chunkSync(engine, placed, chunk));
    }

    onSpawn(engine, placed, eid, type, message) {
        const def = engine.components.get("Gate");
        engine.components.attach(def, eid);
        const gate = def.store;
        const row = def.row(eid);
        gate.in[row] = engine.portFor(type.inputPorts[0], message.x, message.y, message.direction).port;
        gate.out[row] = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction).port;
        gate.open[row] = 1;
        const kinds = gateConnections(
            (tx, ty) => GateBehavior._occupantAt(engine, placed, tx, ty),
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

    onDespawn(engine, placed, eid) {
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

    logicRead(engine, placed, eid, key) {
        if (key !== LOGIC_KEY_OPEN) {
            return null;
        }
        const def = engine.components.get("Gate");
        return def.store.open[def.row(eid)];
    }

    logicWrite(engine, placed, eid, key, value) {
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

    /**
     * Fluid mode rides its buffered type in the lastOutput slot for pipe placement checks.
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} eid
     * @returns {{portIds:number[], lastOutput:number|null}}
     */
    syncData(engine, placed, eid) {
        const def = engine.components.get("Gate");
        const gate = def.store;
        const row = def.row(eid);
        let lastOutput = null;
        if (gate.fluid[row] === 1 && gate.buffered[row] !== EMPTY) {
            lastOutput = gate.buffered[row];
        }
        return {portIds: [gate.out[row]], lastOutput};
    }

    resyncRenderedPorts(engine, placed, eid) {
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
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    onRebuild(engine, placed) {
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
     * @param {PlacedObjects} placed
     * @param {number} x
     * @param {number} y
     * @returns {{type: ObjectType, direction: Direction}|null}
     */
    static _occupantAt(engine, placed, x, y) {
        const objectId = engine.space.ownerAt(x, y, LAYER_SURFACE);
        if (objectId === null) {
            return null;
        }
        const eid = placed.eidByObjectId(objectId);
        if (eid === undefined) {
            return null;
        }
        const type = placed.typeFor(placed.typeIdOf(eid));
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
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    static _review(engine, placed) {
        const def = engine.components.get("Gate");
        const gate = def.store;
        const position = engine.Position;
        for (let row = 0; row < def.count; row += 1) {
            const eid = def.eids[row];
            const kinds = gateConnections(
                (tx, ty) => GateBehavior._occupantAt(engine, placed, tx, ty),
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
                GateBehavior._setMode(engine, placed, eid, target === 1);
            }
        }
    }

    /**
     * Flips a gate's mode, discarding stranded cargo.
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} eid
     * @param {boolean} fluid
     * @returns {void}
     */
    static _setMode(engine, placed, eid, fluid) {
        const def = engine.components.get("Gate");
        const gate = def.store;
        const row = def.row(eid);
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
            gate.fluid[row] = 0;
            GateBehavior._enterItemMode(engine, gate, row);
        }
    }

    /**
     * POST_RESOLVE (last): batches the tick's gate-state changes per observed chunk.
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    static _emitDeltas(engine, placed) {
        const def = engine.components.get("Gate");
        const gate = def.store;
        const position = engine.Position;
        const batches = new Map();
        for (let row = 0; row < def.count; row += 1) {
            if (gate.open[row] === gate.lastOpen[row] && gate.fluid[row] === gate.lastFluid[row]) {
                continue;
            }
            gate.lastOpen[row] = gate.open[row];
            gate.lastFluid[row] = gate.fluid[row];
            const eid = def.eids[row];
            const x = position.x[eid];
            const y = position.y[eid];
            if (!engine.observesTile(x, y)) {
                continue;
            }
            const batch = getOrCreate(batches, chunkId(x, y), () => new GateSetBatchEvent(x, y));
            batch.add(placed.objectIdOf(eid), gate.open[row], gate.fluid[row]);
        }
        for (const batch of batches.values()) {
            engine.emitEvent(batch);
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
                    engine.transfers.submitDrain(gate.in[row], true);
                    gate.buffered[row] = resting;
                    engine.ports.setFluidSource(gate.out[row], resting);
                }
                if (gate.buffered[row] !== EMPTY) {
                    engine.transfers.submitCreate(gate.out[row], gate.buffered[row], item[gate.out[row]] === EMPTY);
                }
                continue;
            }
            if (item[gate.in[row]] !== EMPTY) {
                engine.transfers.submitTransfer(gate.in[row], gate.int[row], item[gate.int[row]] === EMPTY, false);
            }
            if (item[gate.int[row]] !== EMPTY) {
                engine.transfers.submitTransfer(gate.int[row], gate.out[row], item[gate.out[row]] === EMPTY, false);
            }
        }
    }

    /**
     * POST_RESOLVE seam: applies resolved hops (out-port fills deferred); fluid buffers debit.
     * @private
     * @param {GameEngine} engine
     * @param {{outPort:number, item:number}[]} outputFills
     * @returns {void}
     */
    static _runSeam(engine, outputFills) {
        const item = engine.Port.item;
        const def = engine.components.get("Gate");
        const gate = def.store;
        const stage1 = [];
        const stage2 = [];
        for (let row = 0; row < def.count; row += 1) {
            if (gate.fluid[row] === 1) {
                if (gate.buffered[row] !== EMPTY && engine.transfers.wasDest(gate.out[row])) {
                    gate.buffered[row] = EMPTY;
                    engine.ports.setFluidSource(gate.out[row], EMPTY);
                }
                continue;
            }
            const intPort = gate.int[row];
            if (item[intPort] !== EMPTY && engine.transfers.destFor(intPort) !== EMPTY) {
                stage2.push({outPort: gate.out[row], item: item[intPort], intPort});
            }
            const inPort = gate.in[row];
            if (item[inPort] !== EMPTY && engine.transfers.destFor(inPort) !== EMPTY) {
                stage1.push({intPort, item: item[inPort], inPort});
            }
        }
        for (const record of stage2) {
            engine.ports.setItem(record.intPort, EMPTY);
        }
        for (const record of stage1) {
            engine.ports.consumeItem(record.inPort);
        }
        for (const record of stage1) {
            engine.ports.setItem(record.intPort, record.item);
        }
        for (const record of stage2) {
            outputFills.push(record);
        }
    }

    /**
     * PRODUCE_OUTPUTS: writes the seam's passed items into their out-ports.
     * @private
     * @param {GameEngine} engine
     * @param {{outPort:number, item:number}[]} outputFills
     * @returns {void}
     */
    static _fillOutputs(engine, outputFills) {
        for (const record of outputFills) {
            engine.ports.setItem(record.outPort, record.item);
        }
        outputFills.length = 0;
    }

    /**
     * Chunk sync: one batch of the chunk's off-default gates.
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} chunk
     * @returns {GateSetBatchEvent[]}
     */
    static _chunkSync(engine, placed, chunk) {
        const def = engine.components.get("Gate");
        const gate = def.store;
        const position = engine.Position;
        let batch = null;
        for (let row = 0; row < def.count; row += 1) {
            if (gate.open[row] === 1 && gate.fluid[row] === 0) {
                continue;
            }
            const eid = def.eids[row];
            if (chunkId(position.x[eid], position.y[eid]) !== chunk) {
                continue;
            }
            if (batch === null) {
                batch = new GateSetBatchEvent(position.x[eid], position.y[eid]);
            }
            batch.add(placed.objectIdOf(eid), gate.open[row], gate.fluid[row]);
        }
        if (batch === null) {
            return [];
        }
        return [batch];
    }
}
