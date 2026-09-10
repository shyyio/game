import {AbstractBehavior, TickPhase, EMPTY, NO_EID, SyncedFields, SyncedField} from "@spup/sdk";
import {LOGIC_KEY_AMOUNT} from "../common/constants.js";
import {TankComponent} from "./TankComponent.js";

const SYNCED_FIELDS = new SyncedFields("Tank", [new SyncedField("fluidType", EMPTY)]);

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

    get syncedFields() {
        return SYNCED_FIELDS;
    }

    install(engine) {
        engine.components.register(new TankComponent());
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => TankBehavior._submitIntents(engine));
        engine.registerSystem(TickPhase.POST_RESOLVE, () => TankBehavior._finish(engine));
        engine.snapshots.registerRebuildHook(() => TankBehavior._emptyUntyped(engine));
    }

    /**
     * Rebuild hook: a loadout change empties the type column and leaves the amount, so a tank can
     * come back holding units of no fluid. It holds nothing instead.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _emptyUntyped(engine) {
        const tanks = engine.components.get("Tank");
        const tank = tanks.store;
        for (let row = 0; row < tanks.count; row += 1) {
            if (tank.fluidType[row] === EMPTY) {
                tank.amount[row] = 0;
            }
        }
    }

    onSpawn(engine, eid, type, message) {
        const tanks = engine.components.get("Tank");
        tanks.attach(eid);
        const tank = tanks.store;
        const row = tanks.row(eid);
        tank.in[row] = engine.portFor(type.inputPorts[0], message.x, message.y, message.direction).port;
        tank.out[row] = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction).port;
        tank.capacity[row] = this.capacity;
        engine.ports.markFluid(tank.in[row]);
        engine.ports.markFluid(tank.out[row]);
    }

    onDespawn(engine, eid) {
        const tanks = engine.components.get("Tank");
        const row = tanks.row(eid);
        const tank = tanks.store;
        engine.ports.unmarkFluid(tank.in[row]);
        engine.ports.unmarkFluid(tank.out[row]);
        // The port may outlive the tank (an adjacent pipe pins it); it no longer produces.
        engine.ports.setFluidSource(tank.out[row], EMPTY);
    }

    logicRead(engine, eid, key) {
        if (key !== LOGIC_KEY_AMOUNT) {
            return null;
        }
        const tanks = engine.components.get("Tank");
        return tanks.store.amount[tanks.row(eid)];
    }

    logicReadKeys() {
        return [LOGIC_KEY_AMOUNT];
    }

    logicStored(engine, eid) {
        const tanks = engine.components.get("Tank");
        const row = tanks.row(eid);
        if (tanks.store.fluidType[row] === EMPTY) {
            return null;
        }
        return {itemTypeId: tanks.store.fluidType[row], amount: tanks.store.amount[row]};
    }

    /**
     * Restores the denormalized capacity and the port fluid flags after a load.
     * @param {GameEngine} engine
     * @returns {void}
     */
    onRebuild(engine) {
        const placed = engine.placed;
        const tanks = engine.components.get("Tank");
        const tank = tanks.store;
        const eids = tanks.eids;
        for (let row = 0; row < tanks.count; row += 1) {
            tank.capacity[row] = placed.behaviorFor(placed.objectTypeIdOf(eids[row])).capacity;
            engine.ports.markFluid(tank.in[row]);
            engine.ports.markFluid(tank.out[row]);
            if (tank.fluidType[row] !== EMPTY) {
                engine.ports.setFluidSource(tank.out[row], tank.fluidType[row]);
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
        const tanks = engine.components.get("Tank");
        const tank = tanks.store;
        const count = tanks.count;
        for (let row = 0; row < count; row += 1) {
            const resting = item[tank.in[row]];
            if (resting !== EMPTY
                && tank.amount[row] < tank.capacity[row]
                && (tank.amount[row] === 0 || resting === tank.fluidType[row])) {
                engine.transfers.submitDrain(tank.in[row]);
                if (tank.fluidType[row] !== resting) {
                    tank.fluidType[row] = resting;
                    engine.sync.markDirty(tanks, tanks.eids[row]);
                }
                tank.amount[row] += 1;
                engine.ports.setFluidSource(tank.out[row], resting);
            }
            if (tank.amount[row] > 0) {
                engine.transfers.submitCreate(tank.out[row], tank.fluidType[row], item[tank.out[row]] === EMPTY);
            }
        }
    }

    /**
     * POST_RESOLVE: debit a delivered out-port payload; a drained tank frees its type.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _finish(engine) {
        const tanks = engine.components.get("Tank");
        const tank = tanks.store;
        const count = tanks.count;
        for (let row = 0; row < count; row += 1) {
            if (!engine.transfers.wasDest(tank.out[row])) {
                continue;
            }
            tank.amount[row] -= 1;
            if (tank.amount[row] === 0) {
                tank.fluidType[row] = EMPTY;
                engine.ports.setFluidSource(tank.out[row], EMPTY);
                engine.sync.markDirty(tanks, tanks.eids[row]);
            }
        }
    }
}
