import {InspectHeartbeatEvent} from "@/common/InspectEvents.js";
import {LOGIC_KEY_ENABLED, LOGIC_KEY_PROCESSING} from "@/common/constants.js";
import {EMPTY, NO_EID, TickPhase} from "@/sim/GameEngine.js";
import {deterministicRoll} from "@/sim/Rng.js";
import {METRICS_FACT_TYPE_ITEM_PRODUCED} from "@/common/MetricsFact.js";
import {AbstractBehavior} from "@/sim/behaviors/AbstractBehavior.js";
import {syncFluidSource} from "@/sim/behaviors/util.js";

// Recipe input keys are always padded to three slots.
const RECIPE_SLOTS = 3;

// A recipe key packs the slots into one integer (base RECIPE_SLOT_LIMIT), so matching a gathered set
// costs no string per machine per tick.
const RECIPE_SLOT_LIMIT = 1024;

// A manned machine's per-tick processing progress (an unmanned one advances 1).
const MANNED_SPEED_MULTIPLIER = 1.3;

// Per-slot column names, indexed 0..RECIPE_SLOTS-1.
const IN_COLS = ["in0", "in1", "in2"];
const SLOT_COLS = ["slot0", "slot1", "slot2"];
const PROCESSING_COLS = ["processing0", "processing1", "processing2"];

/**
 * Resolves per-slot column names to their arrays, so a hot loop indexes numerically instead of
 * looking the column up by name per entity.
 * @param {object} store
 * @param {string[]} names
 * @returns {ArrayLike<number>[]}
 */
function columns(store, names) {
    return names.map(name => store[name]);
}

/**
 * A recipe machine: each input port gathers one item (consumed via a managed sink), a full slot set
 * matches a recipe (fallback when none), and the output lands in the out-port `processingTicks`
 * later (a managed source-less create).
 */
export class MachineBehavior extends AbstractBehavior {

    /**
     * @param {object} config
     * @param {number} config.processingTicks
     * @param {RecipeDefinition[]} config.recipes
     * @param {number} config.fallback - output when the gathered set matches no recipe
     * @param {number} [config.workerCost] - workers consumed when road-connected to housing (0 = never manned)
     */
    constructor({processingTicks, recipes, fallback, workerCost=0}) {
        super();
        this.processingTicks = processingTicks;
        this.fallback = fallback;
        this.workerCost = workerCost;

        // Packed gathered-set key -> output (see _recipeKey).
        this.recipes = new Map();
        // Packed gathered-set key -> RecipeByproduct, only for recipes that have one.
        this.byproducts = new Map();
        for (const recipe of recipes) {
            const key = this._recipeKey(recipe.inputs);
            this.recipes.set(key, recipe.output);
            if (recipe.byproduct !== null) {
                this.byproducts.set(key, recipe.byproduct);
            }
        }
    }

    _attachType(type) {
        super._attachType(type);
        // Cached off the type: the tick loop reads it per entity, and a getter chaining through
        // type.inputPorts blocks that from folding away.
        this.inputCount = type.inputPorts.length;
        // A second output port is the byproduct port; opt-in per ObjectType.
        this.hasByproductPort = type.outputPorts.length > 1;
    }

    /**
     * @private
     * @param {number[]} inputs
     * @returns {number}
     */
    _recipeKey(inputs) {
        let key = 0;
        for (let i = 0; i < RECIPE_SLOTS; i += 1) {
            const slot = i < inputs.length ? inputs[i] : 0;
            if (slot < 0 || slot >= RECIPE_SLOT_LIMIT) {
                throw new Error(`Recipe input ${slot} does not fit a packed recipe key`);
            }
            key = key * RECIPE_SLOT_LIMIT + slot;
        }
        return key;
    }

    install(engine, placed) {
        engine.defineComponent("Machine", [
            {name: "out", kind: "eid", fill: NO_EID},
            // Byproduct port; NO_EID unless the object type declares a second output port.
            {name: "out2", kind: "eid", fill: NO_EID},
            {name: "in0", kind: "eid", fill: NO_EID},
            {name: "in1", kind: "eid", fill: NO_EID},
            {name: "in2", kind: "eid", fill: NO_EID},
            {name: "slot0", fill: EMPTY},
            {name: "slot1", fill: EMPTY},
            {name: "slot2", fill: EMPTY},
            {name: "processing0", fill: EMPTY},
            {name: "processing1", fill: EMPTY},
            {name: "processing2", fill: EMPTY},
            {name: "remaining", kind: "f32", fill: EMPTY},
            // Overshot progress banked past a finished craft; the next craft starts this far along.
            {name: "carry", kind: "f32"},
            {name: "output", fill: EMPTY},
            {name: "lastOutput", fill: EMPTY},
            // This craft's rolled byproduct (EMPTY if the recipe has none or the roll missed).
            {name: "byproduct", fill: EMPTY},
            {name: "lastByproduct", fill: EMPTY},
            // The two behavior constants the submit pass reads per machine per tick. Kept on the row so
            // the pass never hops through PlacedObject to reach the behavior instance.
            {name: "inputCount"},
            {name: "processingTicks"},
            // Per-tick processing progress (1 unstaffed, MANNED_SPEED_MULTIPLIER fully staffed;
            // grants are full-crew-or-nothing); written by WorkerNetworks via setWorkers.
            {name: "workerStep", kind: "f32", fill: 1},
            // Logic-network switch; a disabled machine pauses whole (no gather, craft, or output).
            {name: "enabled", fill: 1},
        ], {sparse: true});
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => MachineBehavior._submitIntents(engine, placed));
        engine.registerSystem(TickPhase.POST_RESOLVE, () => MachineBehavior._finish(engine, placed));
    }

    onSpawn(engine, placed, eid, type, message) {
        const def = engine.component("Machine");
        engine.attachComponent(def, eid);
        const machine = def.store;
        const row = def.row(eid);
        machine.inputCount[row] = this.inputCount;
        machine.processingTicks[row] = this.processingTicks;
        for (const [i, port] of type.inputPorts.entries()) {
            const inPort = engine.portFor(port, message.x, message.y, message.direction).port;
            machine[IN_COLS[i]][row] = inPort;
            if (port.fluid) {
                engine.markFluidPort(inPort);
            }
        }
        const output = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction);
        machine.out[row] = output.port;
        if (this.hasByproductPort) {
            const byproductOutput = engine.portFor(type.outputPorts[1], message.x, message.y, message.direction);
            machine.out2[row] = byproductOutput.port;
            engine.registerRenderedPort(byproductOutput.port, byproductOutput.tile.x, byproductOutput.tile.y);
        }
        // Explicit: a recycled row may hold stale state from a previous occupant.
        machine.workerStep[row] = 1;
        machine.enabled[row] = 1;
        engine.registerRenderedPort(output.port, output.tile.x, output.tile.y);
        if (this.workerCost > 0) {
            engine.workers.markDirty(engine.footprint(type, message.x, message.y, message.direction));
        }
    }

    onDespawn(engine, placed, eid) {
        const def = engine.component("Machine");
        const machine = def.store;
        const row = def.row(eid);
        for (const [i, port] of this.type.inputPorts.entries()) {
            if (port.fluid) {
                engine.unmarkFluidPort(machine[IN_COLS[i]][row]);
            }
        }
        engine.unregisterRenderedPort(def.store.out[row]);
        engine.setPortFluidSource(def.store.out[row], EMPTY);
        if (this.hasByproductPort) {
            engine.unregisterRenderedPort(def.store.out2[row]);
            engine.setPortFluidSource(def.store.out2[row], EMPTY);
        }
        if (this.workerCost > 0) {
            const position = engine.Position;
            engine.workers.markDirty(engine.footprint(this.type, position.x[eid], position.y[eid], position.direction[eid]));
        }
    }

    setWorkers(engine, placed, eid, granted) {
        const def = engine.component("Machine");
        def.store.workerStep[def.row(eid)] = 1 + (MANNED_SPEED_MULTIPLIER - 1) * (granted / this.workerCost);
    }

    syncData(engine, placed, eid) {
        const def = engine.component("Machine");
        const row = def.row(eid);
        const last = def.store.lastOutput[row];
        let lastOutput = last;
        if (last === EMPTY) {
            lastOutput = null;
        }
        const portIds = [def.store.out[row]];
        if (this.hasByproductPort) {
            portIds.push(def.store.out2[row]);
        }
        return {portIds, lastOutput};
    }

    resyncRenderedPorts(engine, placed, eid) {
        const def = engine.component("Machine");
        const row = def.row(eid);
        const out = def.store.out[row];
        engine.registerRenderedPort(out, engine.Position.x[out], engine.Position.y[out]);
        if (this.hasByproductPort) {
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
        const item = engine.Port.item;
        const def = engine.component("Machine");
        const machine = def.store;
        const row = def.row(eid);
        const inCols = columns(machine, IN_COLS);
        const slotCols = columns(machine, SLOT_COLS);
        const processingCols = columns(machine, PROCESSING_COLS);
        const inputPorts = [];
        const inputMemory = [];
        for (let i = 0; i < this.inputCount; i += 1) {
            const resting = item[inCols[i][row]];
            let restingPort = resting;
            if (resting === EMPTY) {
                restingPort = 0;
            }
            inputPorts.push(restingPort);
            const slot = slotCols[i][row];
            const processing = processingCols[i][row];
            let memory = 0;
            if (slot !== EMPTY) {
                memory = slot;
            } else if (processing !== EMPTY) {
                memory = processing;
            }
            inputMemory.push(memory);
        }
        // The wire carries whole ticks; the fractional countdown stays sim-side.
        let remaining = null;
        if (machine.remaining[row] !== EMPTY) {
            remaining = Math.ceil(machine.remaining[row]);
        }
        const outItem = item[machine.out[row]];
        let displayOutItem = outItem;
        if (outItem === EMPTY) {
            displayOutItem = null;
        }
        let workerStats = null;
        if (this.workerCost > 0) {
            workerStats = engine.workers.inspectFor(objectId);
        }
        let workerCost = null;
        if (this.workerCost > 0) {
            workerCost = this.workerCost;
        }
        let workerGranted = null;
        if (this.workerCost > 0) {
            if (workerStats === null) {
                workerGranted = 0;
            } else {
                workerGranted = workerStats.granted;
            }
        }
        let workerSupply = null;
        if (workerStats !== null) {
            workerSupply = workerStats.supply;
        }
        let workerDemand = null;
        if (workerStats !== null) {
            workerDemand = workerStats.demand;
        }
        return new InspectHeartbeatEvent(
            objectId,
            inputPorts,
            inputMemory,
            remaining,
            this.processingTicks,
            displayOutItem,
            this._inspectRecipeOutput(inputMemory),
            workerCost,
            workerGranted,
            workerSupply,
            workerDemand,
        );
    }

    /**
     * Restores the denormalized behavior constants after a load, so a save written before a machine
     * carried them (or by a build with different constants) still ticks correctly.
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    onRebuild(engine, placed) {
        const def = engine.component("Machine");
        const machine = def.store;
        const eids = def.eids;
        for (let row = 0; row < def.count; row += 1) {
            const behavior = placed.behaviorFor(placed.typeIdOf(eids[row]));
            machine.inputCount[row] = behavior.inputCount;
            machine.processingTicks[row] = behavior.processingTicks;
            syncFluidSource(engine, machine.out[row], machine.output[row]);
            if (behavior.hasByproductPort) {
                syncFluidSource(engine, machine.out2[row], machine.byproduct[row]);
            }
        }
    }

    logicRead(engine, placed, eid, key) {
        const def = engine.component("Machine");
        const row = def.row(eid);
        if (key === LOGIC_KEY_ENABLED) {
            return def.store.enabled[row];
        }
        if (key === LOGIC_KEY_PROCESSING) {
            // A held product is a craft in flight; a switched-off machine is frozen, not working.
            if (def.store.enabled[row] === 0 || def.store.output[row] === EMPTY) {
                return 0;
            }
            return 1;
        }
        return null;
    }

    logicWrite(engine, placed, eid, key, value) {
        if (key !== LOGIC_KEY_ENABLED) {
            return false;
        }
        const def = engine.component("Machine");
        if (value === 0) {
            def.store.enabled[def.row(eid)] = 0;
        } else {
            def.store.enabled[def.row(eid)] = 1;
        }
        return true;
    }

    logicReadKeys() {
        return [LOGIC_KEY_ENABLED, LOGIC_KEY_PROCESSING];
    }

    logicWriteKeys() {
        return [LOGIC_KEY_ENABLED];
    }

    /**
     * The recipe product inferred from the gathered/consumed memory, or null when nothing is gathered.
     * @private
     * @param {number[]} inputMemory
     * @returns {number|null}
     */
    _inspectRecipeOutput(inputMemory) {
        if (!inputMemory.some(item => item > 0)) {
            return null;
        }
        const output = this.recipes.get(this._recipeKey(inputMemory));
        if (output === undefined) {
            return this.fallback;
        }
        return output;
    }

    /**
     * @private
     * @param {ArrayLike<number>[]} slotCols
     * @param {number} row
     * @returns {number} the packed gathered-set key (see _recipeKey)
     */
    _gatheredKey(slotCols, row) {
        let key = 0;
        for (let i = 0; i < RECIPE_SLOTS; i += 1) {
            const slot = i < this.inputCount ? slotCols[i][row] : EMPTY;
            let packed = slot;
            if (slot === EMPTY) {
                packed = 0;
            }
            key = key * RECIPE_SLOT_LIMIT + packed;
        }
        return key;
    }

    /**
     * @private
     * @param {ArrayLike<number>[]} slotCols
     * @param {number} row
     * @returns {number} the produced output for the gathered slots, or the fallback
     */
    _resolveRecipe(slotCols, row) {
        const output = this.recipes.get(this._gatheredKey(slotCols, row));
        if (output === undefined) {
            return this.fallback;
        }
        return output;
    }

    /**
     * Rolls this craft's byproduct, if the matched recipe has one: a deterministic per-craft seed
     * (entity id + the engine's global clock) keeps the outcome reproducible across save/reload.
     * @private
     * @param {ArrayLike<number>[]} slotCols
     * @param {number} row
     * @param {number} eid
     * @param {number} clock
     * @returns {number} the rolled byproduct item type, or EMPTY
     */
    _resolveByproduct(slotCols, row, eid, clock) {
        const byproduct = this.byproducts.get(this._gatheredKey(slotCols, row));
        if (byproduct === undefined) {
            return EMPTY;
        }
        if (deterministicRoll(eid, clock) < byproduct.chance) {
            return byproduct.itemType;
        }
        return EMPTY;
    }

    /**
     * SUBMIT_INTENTS: countdown, gather each idle port's resting input into its slot (managed sink),
     * resolve a full slot set into the processing output + countdown, then create the output when the
     * countdown reaches zero. Processed per machine (machines never share ports).
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    static _submitIntents(engine, placed) {
        const item = engine.Port.item;
        const def = engine.component("Machine");
        const machine = def.store;
        const inCols = columns(machine, IN_COLS);
        const slotCols = columns(machine, SLOT_COLS);
        const processingCols = columns(machine, PROCESSING_COLS);
        const remaining = machine.remaining;
        const carry = machine.carry;
        const output = machine.output;
        const out = machine.out;
        const out2 = machine.out2;
        const byproduct = machine.byproduct;
        const inputCounts = machine.inputCount;
        const processingTicks = machine.processingTicks;
        const workerStep = machine.workerStep;
        const enabled = machine.enabled;
        // Hoisted: `count` and `eids` reach through the descriptor into the world's membership set, and
        // this loop runs once per machine per tick.
        const eids = def.eids;
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            if (enabled[row] === 0) {
                continue;
            }
            const step = workerStep[row];
            // Mid-craft with the product still held: the countdown is the only state that moves, so
            // skip the behavior lookup and the per-slot passes below, which would all no-op.
            if (output[row] !== EMPTY && remaining[row] > step) {
                remaining[row] -= step;
                continue;
            }

            const inputCount = inputCounts[row];
            if (remaining[row] > 0) {
                const next = remaining[row] - step;
                if (next > 0) {
                    remaining[row] = next;
                } else {
                    // Bank the overshoot; the next craft starts that far along.
                    carry[row] -= next;
                    remaining[row] = 0;
                }
            }

            // Gather while idle, or in step on the tick a free output lets the next set load.
            const idle = output[row] === EMPTY;
            const gathering = idle || (remaining[row] === 0 && item[out[row]] === EMPTY);

            // One pass: fill each free slot from its resting input and count what the machine holds
            // afterward. Filling and counting separately walked the slot columns twice.
            let filled = 0;
            for (let i = 0; i < inputCount; i += 1) {
                const slotCol = slotCols[i];
                let slot = slotCol[row];
                if (gathering && slot === EMPTY) {
                    const inPort = inCols[i][row];
                    const resting = item[inPort];
                    if (resting !== EMPTY) {
                        engine.submitDrain(inPort, true);
                        slot = resting;
                        slotCol[row] = resting;
                    }
                }
                if (slot !== EMPTY) {
                    filled += 1;
                }
            }

            // Every port contributed: match the recipe, start the countdown, move slots into processing.
            // A machine still holding a product cannot load the next set, so it skips the craft.
            if (idle && filled === inputCount) {
                // Only the recipe match needs the behavior instance, and only on the tick a set
                // completes — rare next to the per-tick passes above.
                const behavior = placed.behaviorFor(placed.typeIdOf(eids[row]));
                output[row] = behavior._resolveRecipe(slotCols, row);
                syncFluidSource(engine, out[row], output[row]);
                if (behavior.hasByproductPort) {
                    byproduct[row] = behavior._resolveByproduct(slotCols, row, eids[row], engine.clock);
                    syncFluidSource(engine, out2[row], byproduct[row]);
                }
                const start = processingTicks[row] - carry[row];
                if (start > 0) {
                    remaining[row] = start;
                    carry[row] = 0;
                } else {
                    // Banked progress covers the whole craft; the surplus keeps carrying.
                    remaining[row] = 0;
                    carry[row] = -start;
                }
                for (let i = 0; i < inputCount; i += 1) {
                    processingCols[i][row] = slotCols[i][row];
                    slotCols[i][row] = EMPTY;
                }
            }

            if (remaining[row] === 0) {
                engine.submitCreate(out[row], output[row], item[out[row]] === EMPTY);
                if (byproduct[row] !== EMPTY) {
                    engine.submitCreate(out2[row], byproduct[row], item[out2[row]] === EMPTY);
                }
            }
        }
    }

    /**
     * POST_RESOLVE: a machine whose output (and byproduct, if this craft rolled one) was delivered
     * records last_output/last_byproduct and goes idle.
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    static _finish(engine, placed) {
        const def = engine.component("Machine");
        const machine = def.store;
        const processingCols = columns(machine, PROCESSING_COLS);
        const count = def.count;
        const eids = def.eids;
        for (let row = 0; row < count; row += 1) {
            const byproductPending = machine.byproduct[row] !== EMPTY;
            const byproductDelivered = !byproductPending || engine.wasResolvedDest(machine.out2[row]);
            if (engine.wasResolvedDest(machine.out[row]) && byproductDelivered) {
                const eid = eids[row];
                engine.emitMetrics(
                    METRICS_FACT_TYPE_ITEM_PRODUCED, placed.ownerIdOf(eid), machine.output[row], 1,
                );
                machine.lastOutput[row] = machine.output[row];
                machine.output[row] = EMPTY;
                machine.remaining[row] = EMPTY;
                if (byproductPending) {
                    engine.emitMetrics(
                        METRICS_FACT_TYPE_ITEM_PRODUCED, placed.ownerIdOf(eid), machine.byproduct[row], 1,
                    );
                    machine.lastByproduct[row] = machine.byproduct[row];
                    machine.byproduct[row] = EMPTY;
                }
                for (let i = 0; i < RECIPE_SLOTS; i += 1) {
                    processingCols[i][row] = EMPTY;
                }
            }
        }
    }
}
