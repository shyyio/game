import {InspectHeartbeatEvent} from "@/common/InspectEvents.js";
import {TickPhase} from "@/sim/GameEngine.js";
import {EMPTY, NO_EID} from "@/sim/sentinels.js";
import {METRICS_FACT_TYPE_ITEM_PRODUCED} from "@/common/MetricsFact.js";
import {AbstractBehavior} from "@/sim/behaviors/AbstractBehavior.js";
import {syncFluidSource} from "@/sim/behaviors/util.js";

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
     * @param {number} config.secondaryOutput.itemType
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

    install(engine, placed) {
        engine.components.define("Generator", [
            {name: "out", kind: "eid", fill: NO_EID},
            {name: "remaining", kind: "f32", fill: EMPTY},
            {name: "carry", kind: "f32"},
            {name: "output", fill: EMPTY},
            {name: "lastOutput", fill: EMPTY},
            {name: "processingTicks"},
            // Secondary cycle; unused columns stay at fill for a type with no secondary port.
            {name: "out2", kind: "eid", fill: NO_EID},
            {name: "remaining2", kind: "f32", fill: EMPTY},
            {name: "carry2", kind: "f32"},
            {name: "output2", fill: EMPTY},
            {name: "lastOutput2", fill: EMPTY},
            {name: "processingTicks2"},
        ], {sparse: true});
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => GeneratorBehavior._submitIntents(engine, placed));
        engine.registerSystem(TickPhase.POST_RESOLVE, () => GeneratorBehavior._finish(engine, placed));
    }

    onSpawn(engine, placed, eid, type, message) {
        const def = engine.components.get("Generator");
        engine.components.attach(def, eid);
        const generator = def.store;
        const row = def.row(eid);
        const output = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction);
        generator.out[row] = output.port;
        generator.processingTicks[row] = this.processingTicks;
        engine.registerRenderedPort(output.port, output.tile.x, output.tile.y);
        syncFluidSource(engine, output.port, this.output);
        if (this.hasSecondaryPort) {
            const secondary = engine.portFor(type.outputPorts[1], message.x, message.y, message.direction);
            generator.out2[row] = secondary.port;
            generator.processingTicks2[row] = this.secondaryOutput.processingTicks;
            engine.registerRenderedPort(secondary.port, secondary.tile.x, secondary.tile.y);
            syncFluidSource(engine, secondary.port, this.secondaryOutput.itemType);
        }
    }

    onDespawn(engine, placed, eid) {
        const def = engine.components.get("Generator");
        const row = def.row(eid);
        engine.unregisterRenderedPort(def.store.out[row]);
        engine.setPortFluidSource(def.store.out[row], EMPTY);
        if (this.hasSecondaryPort) {
            engine.unregisterRenderedPort(def.store.out2[row]);
            engine.setPortFluidSource(def.store.out2[row], EMPTY);
        }
    }

    syncData(engine, placed, eid) {
        const def = engine.components.get("Generator");
        const row = def.row(eid);
        const last = def.store.lastOutput[row];
        let lastOutput = last;
        if (last === EMPTY) {
            lastOutput = null;
        }
        const portIds = [def.store.out[row]];
        if (this.hasSecondaryPort) {
            portIds.push(def.store.out2[row]);
        }
        return {portIds, lastOutput};
    }

    resyncRenderedPorts(engine, placed, eid) {
        const def = engine.components.get("Generator");
        const row = def.row(eid);
        const out = def.store.out[row];
        engine.registerRenderedPort(out, engine.Position.x[out], engine.Position.y[out]);
        if (this.hasSecondaryPort) {
            const out2 = def.store.out2[row];
            engine.registerRenderedPort(out2, engine.Position.x[out2], engine.Position.y[out2]);
        }
    }

    /**
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} eid
     * @param {number} objectId
     * @returns {InspectHeartbeatEvent}
     */
    inspect(engine, placed, eid, objectId) {
        const def = engine.components.get("Generator");
        const generator = def.store;
        const row = def.row(eid);
        let remaining = null;
        if (generator.remaining[row] !== EMPTY) {
            remaining = Math.ceil(generator.remaining[row]);
        }
        const outItem = engine.Port.item[generator.out[row]];
        let displayOutItem = outItem;
        if (outItem === EMPTY) {
            displayOutItem = null;
        }
        return new InspectHeartbeatEvent(objectId, [], [], remaining, this.processingTicks, displayOutItem, this.output);
    }

    /**
     * Restores the denormalized countdown lengths after a load (see MachineBehavior#onRebuild).
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    onRebuild(engine, placed) {
        const def = engine.components.get("Generator");
        const generator = def.store;
        const eids = def.eids;
        for (let row = 0; row < def.count; row += 1) {
            const behavior = placed.behaviorFor(placed.typeIdOf(eids[row]));
            generator.processingTicks[row] = behavior.processingTicks;
            syncFluidSource(engine, generator.out[row], behavior.output);
            if (behavior.hasSecondaryPort) {
                generator.processingTicks2[row] = behavior.secondaryOutput.processingTicks;
                syncFluidSource(engine, generator.out2[row], behavior.secondaryOutput.itemType);
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
     * @param {ArrayLike<number>} outPort
     * @param {ArrayLike<number>} processingTicks
     * @param {number} itemType
     * @param {number} row
     * @returns {void}
     */
    static _advanceCycle(engine, remaining, carry, output, outPort, processingTicks, itemType, row) {
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
            output[row] = itemType;
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
            engine.submitCreate(outPort[row], output[row], item[outPort[row]] === EMPTY);
        }
    }

    /**
     * SUBMIT_INTENTS: advances the main cycle every row, and the secondary cycle only for rows a
     * second output port was wired onto (see onSpawn).
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    static _submitIntents(engine, placed) {
        const def = engine.components.get("Generator");
        const generator = def.store;
        const eids = def.eids;
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            let itemType = generator.output[row];
            if (itemType === EMPTY) {
                itemType = placed.behaviorFor(placed.typeIdOf(eids[row])).output;
            }
            GeneratorBehavior._advanceCycle(
                engine, generator.remaining, generator.carry, generator.output, generator.out,
                generator.processingTicks, itemType, row,
            );
            if (generator.out2[row] === NO_EID) {
                continue;
            }
            let secondaryItemType = generator.output2[row];
            if (secondaryItemType === EMPTY) {
                secondaryItemType = placed.behaviorFor(placed.typeIdOf(eids[row])).secondaryOutput.itemType;
            }
            GeneratorBehavior._advanceCycle(
                engine, generator.remaining2, generator.carry2, generator.output2, generator.out2,
                generator.processingTicks2, secondaryItemType, row,
            );
        }
    }

    /**
     * POST_RESOLVE: a delivered cycle (main or secondary) records its last_output and goes idle.
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    static _finish(engine, placed) {
        const def = engine.components.get("Generator");
        const generator = def.store;
        const eids = def.eids;
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            const eid = eids[row];
            if (engine.wasResolvedDest(generator.out[row])) {
                engine.emitMetrics(
                    METRICS_FACT_TYPE_ITEM_PRODUCED, placed.ownerIdOf(eid), generator.output[row], 1,
                );
                generator.lastOutput[row] = generator.output[row];
                generator.output[row] = EMPTY;
                generator.remaining[row] = EMPTY;
            }
            if (generator.out2[row] !== NO_EID && engine.wasResolvedDest(generator.out2[row])) {
                engine.emitMetrics(
                    METRICS_FACT_TYPE_ITEM_PRODUCED, placed.ownerIdOf(eid), generator.output2[row], 1,
                );
                generator.lastOutput2[row] = generator.output2[row];
                generator.output2[row] = EMPTY;
                generator.remaining2[row] = EMPTY;
            }
        }
    }
}
