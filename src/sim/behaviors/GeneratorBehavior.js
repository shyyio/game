import {InspectHeartbeatEvent} from "@/common/InspectEvents.js";
import {AbstractSystem} from "@/sim/AbstractSystem.js";
import {EMPTY, NO_EID} from "@/sim/sentinels.js";
import {AbstractBehavior} from "@/common/behaviors/AbstractBehavior.js";
import {SyncedFields, SyncedField} from "@/common/SyncedFields.js";
import {syncFluidSource} from "@/sim/behaviors/util.js";
import {GeneratorComponent} from "@/sim/behaviors/GeneratorComponent.js";

const SYNCED_FIELDS = new SyncedFields("Generator", [new SyncedField("lastOutput", EMPTY)]);

/**
 * Ticks every generator.
 */
class GeneratorSystem extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        super();
        this.engine = engine;
    }

    submitIntents() {
        GeneratorBehavior._submitIntents(this.engine);
    }

    postResolve() {
        GeneratorBehavior._finish(this.engine);
    }
}

/**
 * A passive producer with no input port: a fixed item lands in its output port every
 * `processingTicks`, like ExtractorBehavior but never bound to a resource tile. An optional
 * secondary output (its own independent, non-recipe cadence — e.g. Air Filter's Water trickle)
 * lands in the object type's second output port every `secondaryOutput.processingTicks`.
 */
export class GeneratorBehavior extends AbstractBehavior {

    /**
     * @param {object} config
     * @param {number} config.processingTicks
     * @param {number} config.output
     * @param {object} [config.secondaryOutput]
     * @param {number} config.secondaryOutput.itemTypeId
     * @param {number} config.secondaryOutput.processingTicks
     */
    constructor({processingTicks, output, secondaryOutput=null}) {
        super();
        this.processingTicks = processingTicks;
        this.output = output;
        this.secondaryOutput = secondaryOutput;
    }

    _attachType(type) {
        super._attachType(type);
        this.hasSecondaryPort = this.secondaryOutput !== null;
    }

    get syncedFields() {
        return SYNCED_FIELDS;
    }

    install(engine) {
        engine.components.register(new GeneratorComponent());
        engine.registerSystem(new GeneratorSystem(engine));
    }

    onSpawn(engine, eid, type, message) {
        const generators = engine.components.getComponentByName("Generator");
        generators.attach(eid);
        const generator = generators.store;
        const row = generators.getRowByEid(eid);
        const output = engine.getPortAt(type.outputPorts[0], message.x, message.y, message.direction);
        generator.outputPort[row] = output.port;
        generator.processingTicks[row] = this.processingTicks;
        engine.portItems.addOutputPort(output.port, output.tile.x, output.tile.y);
        syncFluidSource(engine, output.port, this.output);
        if (this.hasSecondaryPort) {
            const secondary = engine.getPortAt(type.outputPorts[1], message.x, message.y, message.direction);
            generator.outputPort2[row] = secondary.port;
            generator.processingTicks2[row] = this.secondaryOutput.processingTicks;
            engine.portItems.addOutputPort(secondary.port, secondary.tile.x, secondary.tile.y);
            syncFluidSource(engine, secondary.port, this.secondaryOutput.itemTypeId);
        }
    }

    onDespawn(engine, eid) {
        const generators = engine.components.getComponentByName("Generator");
        const row = generators.getRowByEid(eid);
        engine.portItems.removeOutputPort(generators.store.outputPort[row]);
        engine.ports.setFluidSource(generators.store.outputPort[row], EMPTY);
        if (this.hasSecondaryPort) {
            engine.portItems.removeOutputPort(generators.store.outputPort2[row]);
            engine.ports.setFluidSource(generators.store.outputPort2[row], EMPTY);
        }
    }

    getRenderedPortEids(engine, eid) {
        const generators = engine.components.getComponentByName("Generator");
        const row = generators.getRowByEid(eid);
        const portEids = [generators.store.outputPort[row]];
        if (this.hasSecondaryPort) {
            portEids.push(generators.store.outputPort2[row]);
        }
        return portEids;
    }

    resyncRenderedPorts(engine, eid) {
        const generators = engine.components.getComponentByName("Generator");
        const row = generators.getRowByEid(eid);
        const out = generators.store.outputPort[row];
        engine.portItems.addOutputPort(out, engine.Position.x[out], engine.Position.y[out]);
        if (this.hasSecondaryPort) {
            const out2 = generators.store.outputPort2[row];
            engine.portItems.addOutputPort(out2, engine.Position.x[out2], engine.Position.y[out2]);
        }
    }

    /**
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {number} objectRef
     * @returns {InspectHeartbeatEvent}
     */
    inspect(engine, eid, objectRef) {
        const generators = engine.components.getComponentByName("Generator");
        const generator = generators.store;
        const row = generators.getRowByEid(eid);
        let remaining = null;
        if (generator.remaining[row] !== EMPTY) {
            remaining = Math.ceil(generator.remaining[row]);
        }
        const outItem = engine.Port.item[generator.outputPort[row]];
        let displayOutItem = outItem;
        if (outItem === EMPTY) {
            displayOutItem = null;
        }
        return new InspectHeartbeatEvent(objectRef, [], [], remaining, this.processingTicks, displayOutItem, this.output);
    }

    /**
     * Restores the denormalized countdown lengths after a load (see MachineBehavior#onRebuild).
     * @param {GameEngine} engine
     * @returns {void}
     */
    onRebuild(engine) {
        const placed = engine.placed;
        const generators = engine.components.getComponentByName("Generator");
        const generator = generators.store;
        const eids = generators.eids;
        for (let row = 0; row < generators.count; row += 1) {
            const behavior = placed.getBehaviorByTypeId(placed.getObjectTypeIdByEid(eids[row]));
            generator.processingTicks[row] = behavior.processingTicks;
            syncFluidSource(engine, generator.outputPort[row], behavior.output);
            if (behavior.hasSecondaryPort) {
                generator.processingTicks2[row] = behavior.secondaryOutput.processingTicks;
                syncFluidSource(engine, generator.outputPort2[row], behavior.secondaryOutput.itemTypeId);
            }
        }
    }

    /**
     * Advances one output cycle in place: counts down, starts the next cycle once idle (fixed item,
     * no recipe match needed), and (re)submits the create once the countdown reaches zero.
     * @private
     * @param {GameEngine} engine
     * @param {ArrayLike<number>} remaining
     * @param {ArrayLike<number>} carry
     * @param {ArrayLike<number>} output
     * @param {ArrayLike<number>} outputPort
     * @param {ArrayLike<number>} processingTicks
     * @param {number} itemTypeId
     * @param {number} row
     * @returns {void}
     */
    static _advanceCycle(engine, remaining, carry, output, outputPort, processingTicks, itemTypeId, row) {
        if (remaining[row] > 0) {
            const next = remaining[row] - 1;
            if (next > 0) {
                remaining[row] = next;
            } else {
                // Bank the overshoot; the next cycle starts that far along.
                carry[row] -= next;
                remaining[row] = 0;
            }
        }
        if (output[row] === EMPTY) {
            output[row] = itemTypeId;
            const start = processingTicks[row] - carry[row];
            if (start > 0) {
                remaining[row] = start;
                carry[row] = 0;
            } else {
                // Banked progress covers the whole cycle; the surplus keeps carrying.
                remaining[row] = 0;
                carry[row] = -start;
            }
        }
        if (remaining[row] === 0) {
            const item = engine.Port.item;
            engine.transfers.submitCreate(outputPort[row], output[row], item[outputPort[row]] === EMPTY);
        }
    }

    /**
     * SUBMIT_INTENTS: advances the main cycle every row, and the secondary cycle only for rows a
     * second output port was wired onto (see onSpawn).
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _submitIntents(engine) {
        const placed = engine.placed;
        const generators = engine.components.getComponentByName("Generator");
        const generator = generators.store;
        const eids = generators.eids;
        const count = generators.count;
        for (let row = 0; row < count; row += 1) {
            let itemTypeId = generator.output[row];
            if (itemTypeId === EMPTY) {
                itemTypeId = placed.getBehaviorByTypeId(placed.getObjectTypeIdByEid(eids[row])).output;
            }
            GeneratorBehavior._advanceCycle(
                engine, generator.remaining, generator.carry, generator.output, generator.outputPort,
                generator.processingTicks, itemTypeId, row,
            );
            if (generator.outputPort2[row] === NO_EID) {
                continue;
            }
            let secondaryItemTypeId = generator.output2[row];
            if (secondaryItemTypeId === EMPTY) {
                secondaryItemTypeId = placed.getBehaviorByTypeId(placed.getObjectTypeIdByEid(eids[row])).secondaryOutput.itemTypeId;
            }
            GeneratorBehavior._advanceCycle(
                engine, generator.remaining2, generator.carry2, generator.output2, generator.outputPort2,
                generator.processingTicks2, secondaryItemTypeId, row,
            );
        }
    }

    /**
     * POST_RESOLVE: a delivered cycle (main or secondary) records its last_output and goes idle.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _finish(engine) {
        const placed = engine.placed;
        const generators = engine.components.getComponentByName("Generator");
        const generator = generators.store;
        const eids = generators.eids;
        const count = generators.count;
        for (let row = 0; row < count; row += 1) {
            const eid = eids[row];
            if (engine.transfers.isDest(generator.outputPort[row])) {
                engine.itemProduced.notify(placed.getClaimOwnerByEid(eid), generator.output[row], 1);
                if (generator.lastOutput[row] !== generator.output[row]) {
                    generator.lastOutput[row] = generator.output[row];
                    engine.sync.markDirty(generators, eid);
                }
                generator.output[row] = EMPTY;
                generator.remaining[row] = EMPTY;
            }
            if (generator.outputPort2[row] !== NO_EID && engine.transfers.isDest(generator.outputPort2[row])) {
                engine.itemProduced.notify(placed.getClaimOwnerByEid(eid), generator.output2[row], 1);
                generator.lastOutput2[row] = generator.output2[row];
                generator.output2[row] = EMPTY;
                generator.remaining2[row] = EMPTY;
            }
        }
    }
}
