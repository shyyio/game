import {AbstractBehavior, TickPhase, EMPTY, NO_EID} from "@spup/sdk";
import {FLUID_UNIT} from "../common/constants.js";
import {TankFluidSetEvent} from "../common/events.js";

/**
 * A fluid buffer: drains type-matching in-port payloads into an amount counter and creates one
 * out-port payload per tick while holding fluid.
 */
export class TankBehavior extends AbstractBehavior {

    /**
     * @param {object} config
     * @param {number} config.capacity - units the tank holds
     */
    constructor({capacity}) {
        super();
        this.capacity = capacity;
    }

    install(engine, placed) {
        engine.defineComponent("Tank", [
            {name: "in", kind: "eid", fill: NO_EID},
            {name: "out", kind: "eid", fill: NO_EID},
            {name: "fluidType", fill: EMPTY},
            {name: "amount"},
            // Denormalized from the behavior so the tick pass stays on the row.
            {name: "capacity"},
            // Last type synced to clients, so the tick emits only type changes.
            {name: "lastType", fill: EMPTY},
        ], {sparse: true});
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => TankBehavior._submitIntents(engine));
        engine.registerSystem(TickPhase.POST_RESOLVE, () => TankBehavior._finish(engine, placed));
    }

    onSpawn(engine, placed, eid, type, message) {
        const def = engine.component("Tank");
        engine.attachComponent(def, eid);
        const tank = def.store;
        const row = def.row(eid);
        tank.in[row] = engine.portFor(type.inputPorts[0], message.x, message.y, message.direction).port;
        tank.out[row] = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction).port;
        tank.capacity[row] = this.capacity;
        engine.markFluidPort(tank.in[row]);
        engine.markFluidPort(tank.out[row]);
    }

    onDespawn(engine, placed, eid) {
        const def = engine.component("Tank");
        const row = def.row(eid);
        const tank = def.store;
        engine.unmarkFluidPort(tank.in[row]);
        engine.unmarkFluidPort(tank.out[row]);
        // The port may outlive the tank (an adjacent pipe pins it); it no longer produces.
        engine.setPortFluidSource(tank.out[row], EMPTY);
    }

    /**
     * The held fluid rides the lastOutput slot, so a subscribing client learns the type.
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} eid
     * @returns {{portIds:number[], lastOutput:number|null}}
     */
    syncData(engine, placed, eid) {
        const def = engine.component("Tank");
        const row = def.row(eid);
        let lastOutput = null;
        if (def.store.amount[row] > 0) {
            lastOutput = def.store.fluidType[row];
        }
        return {portIds: [], lastOutput};
    }

    /**
     * Restores the denormalized capacity and the port fluid flags after a load.
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    onRebuild(engine, placed) {
        const def = engine.component("Tank");
        const tank = def.store;
        const eids = def.eids;
        for (let row = 0; row < def.count; row += 1) {
            tank.capacity[row] = placed.behaviorFor(placed.typeIdOf(eids[row])).capacity;
            engine.markFluidPort(tank.in[row]);
            engine.markFluidPort(tank.out[row]);
            if (tank.fluidType[row] !== EMPTY) {
                engine.setPortFluidSource(tank.out[row], tank.fluidType[row]);
            }
        }
    }

    /**
     * SUBMIT_INTENTS: drain a type-matching in-port payload; create an out-port payload while
     * fluid is held.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _submitIntents(engine) {
        const item = engine.Port.item;
        const def = engine.component("Tank");
        const tank = def.store;
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            const resting = item[tank.in[row]];
            if (resting !== EMPTY
                && tank.capacity[row] - tank.amount[row] >= FLUID_UNIT
                && (tank.amount[row] === 0 || resting === tank.fluidType[row])) {
                engine.submitDrain(tank.in[row], true);
                tank.fluidType[row] = resting;
                tank.amount[row] += FLUID_UNIT;
                engine.setPortFluidSource(tank.out[row], resting);
            }
            if (tank.amount[row] >= FLUID_UNIT) {
                engine.submitCreate(tank.out[row], tank.fluidType[row], item[tank.out[row]] === EMPTY);
            }
        }
    }

    /**
     * POST_RESOLVE: debit a delivered out-port payload (a drained tank frees its type); sync type
     * changes to observed chunks.
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    static _finish(engine, placed) {
        const def = engine.component("Tank");
        const tank = def.store;
        const position = engine.Position;
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            if (engine.wasResolvedDest(tank.out[row])) {
                tank.amount[row] -= FLUID_UNIT;
                if (tank.amount[row] === 0) {
                    tank.fluidType[row] = EMPTY;
                    engine.setPortFluidSource(tank.out[row], EMPTY);
                }
            }
            if (tank.fluidType[row] === tank.lastType[row]) {
                continue;
            }
            tank.lastType[row] = tank.fluidType[row];
            const eid = def.eids[row];
            if (!engine.observesTile(position.x[eid], position.y[eid])) {
                continue;
            }
            engine.emitEvent(new TankFluidSetEvent(
                position.x[eid],
                position.y[eid],
                placed.objectIdOf(eid),
                tank.fluidType[row],
            ));
        }
    }
}
