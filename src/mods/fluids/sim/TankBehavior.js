import {AbstractBehavior, EMPTY, NO_EID, SyncedFieldSet, ProductField, AbstractSystem, AbstractComponent, FieldDefinition} from "@spup/sdk";
import {LOGIC_KEY_AMOUNT} from "../common/constants.js";

/**
 * A tank: its ports, the fluid it holds and how much.
 */
class TankComponent extends AbstractComponent {

    constructor() {
        super("Tank", [
            new FieldDefinition("inputPort", "eid", NO_EID),
            new FieldDefinition("outputPort", "eid", NO_EID),
            new FieldDefinition("fluidType", "item", EMPTY),
            new FieldDefinition("amount"),
            // Denormalized from the behavior so the tick pass stays on the row.
            new FieldDefinition("capacity"),
        ], {isSparse: true});
    }
}

const SYNCED_FIELDS = new SyncedFieldSet("Tank", [new ProductField("fluidType", EMPTY)]);

/**
 * Ticks every tank.
 */
class TankSystem extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        super();
        this.engine = engine;
    }

    submitIntents() {
        TankBehavior._submitIntents(this.engine);
    }

    postResolve() {
        TankBehavior._finish(this.engine);
    }
}

/**
 * A fluid buffer: drains type-matching input port payloads into an amount counter and creates one
 * output port payload per tick while holding fluid.
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
        engine.registerSystem(new TankSystem(engine));
    }

    onSpawn(engine, eid, type, message) {
        const tanks = engine.components.getComponentByName("Tank");
        tanks.attach(eid);
        const tank = tanks.store;
        const row = tanks.getRowByEid(eid);
        tank.inputPort[row] = engine.getPortAt(type.inputPorts[0], message.x, message.y, message.direction).port;
        tank.outputPort[row] = engine.getPortAt(type.outputPorts[0], message.x, message.y, message.direction).port;
        tank.capacity[row] = this.capacity;
        engine.ports.markFluid(tank.inputPort[row]);
        engine.ports.markFluid(tank.outputPort[row]);
    }

    onDespawn(engine, eid) {
        const tanks = engine.components.getComponentByName("Tank");
        const row = tanks.getRowByEid(eid);
        const tank = tanks.store;
        engine.ports.unmarkFluid(tank.inputPort[row]);
        engine.ports.unmarkFluid(tank.outputPort[row]);
        // The port may outlive the tank (an adjacent pipe pins it); it no longer produces.
        engine.ports.setFluidSource(tank.outputPort[row], EMPTY);
    }

    logicRead(engine, eid, key) {
        if (key !== LOGIC_KEY_AMOUNT) {
            return null;
        }
        const tanks = engine.components.getComponentByName("Tank");
        return tanks.store.amount[tanks.getRowByEid(eid)];
    }

    getLogicReadKeys() {
        return [LOGIC_KEY_AMOUNT];
    }

    /**
     * @returns {StoredStock|null}
     */
    logicStored(engine, eid) {
        const tanks = engine.components.getComponentByName("Tank");
        const row = tanks.getRowByEid(eid);
        if (tanks.store.fluidType[row] === EMPTY) {
            return null;
        }
        return {itemTypeId: tanks.store.fluidType[row], amount: tanks.store.amount[row]};
    }

    /**
     * Restores the denormalized capacity and the port fluid flags after a load. A loadout change
     * empties the type column and leaves the amount, so a tank of no fluid holds nothing.
     * @param {GameEngine} engine
     * @returns {void}
     */
    onRebuild(engine) {
        const placed = engine.placed;
        const tanks = engine.components.getComponentByName("Tank");
        const tank = tanks.store;
        const eids = tanks.eids;
        for (let row = 0; row < tanks.count; row += 1) {
            tank.capacity[row] = placed.getBehaviorByTypeId(placed.getObjectTypeIdByEid(eids[row])).capacity;
            engine.ports.markFluid(tank.inputPort[row]);
            engine.ports.markFluid(tank.outputPort[row]);
            if (tank.fluidType[row] === EMPTY) {
                tank.amount[row] = 0;
            } else {
                engine.ports.setFluidSource(tank.outputPort[row], tank.fluidType[row]);
            }
        }
    }

    /**
     * SUBMIT_INTENTS: drain a type-matching input port payload; create an output port payload while
     * fluid is held.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _submitIntents(engine) {
        const item = engine.Port.item;
        const tanks = engine.components.getComponentByName("Tank");
        const tank = tanks.store;
        const count = tanks.count;
        for (let row = 0; row < count; row += 1) {
            const resting = item[tank.inputPort[row]];
            if (resting !== EMPTY
                && tank.amount[row] < tank.capacity[row]
                && (tank.amount[row] === 0 || resting === tank.fluidType[row])) {
                engine.transfers.submitDrain(tank.inputPort[row]);
                if (tank.fluidType[row] !== resting) {
                    tank.fluidType[row] = resting;
                    engine.sync.markDirty(tanks, tanks.eids[row]);
                }
                tank.amount[row] += 1;
                engine.ports.setFluidSource(tank.outputPort[row], resting);
            }
            if (tank.amount[row] > 0) {
                engine.transfers.submitCreate(tank.outputPort[row], tank.fluidType[row], item[tank.outputPort[row]] === EMPTY);
            }
        }
    }

    /**
     * POST_RESOLVE: debit a delivered output port payload; a drained tank frees its type.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _finish(engine) {
        const tanks = engine.components.getComponentByName("Tank");
        const tank = tanks.store;
        const count = tanks.count;
        for (let row = 0; row < count; row += 1) {
            if (!engine.transfers.isDest(tank.outputPort[row])) {
                continue;
            }
            tank.amount[row] -= 1;
            if (tank.amount[row] === 0) {
                tank.fluidType[row] = EMPTY;
                engine.ports.setFluidSource(tank.outputPort[row], EMPTY);
                engine.sync.markDirty(tanks, tanks.eids[row]);
            }
        }
    }
}
