import {chunkId} from "@/common/util.js";
import {InspectHeartbeatEvent} from "@/common/InspectEvents.js";
import {EMPTY, NO_EID, TickPhase} from "@/common/sim/GameEngine.js";

// Position layer for resource cover: an extraction tile stores its resource type as the cell userData.
const LAYER_RESOURCE = "R";

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
 * A component+system bundle giving a placeable object type its sim behavior. PlacedObjects owns the
 * generic entity lifecycle (spawn/despawn/chunk-sync/inspect); a behavior supplies the type-specific
 * pieces: its components and systems ({@link install}, once per behavior class per engine — never
 * read instance config there) and the per-entity hooks. One behavior instance belongs to exactly one
 * ObjectType; systems read per-entity config through `placed.behaviorFor(typeId)`.
 */
export class AbstractBehavior {

    constructor() {
        /**
         * @type {ObjectType|null}
         */
        this.type = null;
        // Labor interface, read by LaborNetworks: a positive laborSupply makes the type a source, a
        // positive laborCost a consumer.
        this.laborSupply = 0;
        this.laborCost = 0;
    }

    /**
     * Called by the owning ObjectType's constructor.
     * @param {ObjectType} type
     * @returns {void}
     */
    _attachType(type) {
        if (this.type !== null && this.type !== type) {
            throw new Error(`Behavior already attached to "${this.type.name}"; construct one instance per ObjectType`);
        }
        this.type = type;
    }

    /**
     * Defines this behavior class's components and registers its systems.
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    install(engine, placed) {

    }

    /**
     * Whether `message` may spawn an entity (e.g. a required resource is present).
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {ObjectType} type
     * @param {CreateObjectMessage} message
     * @returns {boolean}
     */
    canSpawn(engine, placed, type, message) {
        return true;
    }

    /**
     * Wires the freshly spawned entity: attaches behavior components, resolves ports, registers
     * rendered ports.
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} eid
     * @param {ObjectType} type
     * @param {CreateObjectMessage} message
     * @returns {number[]} the rendered out-port ids, in wire order
     */
    onSpawn(engine, placed, eid, type, message) {
        return [];
    }

    /**
     * Releases the entity's behavior state (rendered ports, derived indexes) before it is destroyed.
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} eid
     * @returns {void}
     */
    onDespawn(engine, placed, eid) {

    }

    /**
     * The behavior payload of the entity's chunk-sync event.
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} eid
     * @returns {{portIds:number[], lastOutput:number|null}}
     */
    syncData(engine, placed, eid) {
        return {portIds: [], lastOutput: null};
    }

    /**
     * The entity's current inspect snapshot.
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} eid
     * @param {number} objectId
     * @returns {InspectHeartbeatEvent|null}
     */
    inspect(engine, placed, eid, objectId) {
        return null;
    }

    /**
     * Re-registers the entity's rendered ports after a load repopulates the world.
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} eid
     * @returns {void}
     */
    resyncRenderedPorts(engine, placed, eid) {

    }

    /**
     * Applies the labor allocation to one entity: `granted` workers of its laborCost (0 = none).
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} eid
     * @param {number} granted
     * @returns {void}
     */
    setLabor(engine, placed, eid, granted) {

    }

    /**
     * Rebuilds class-level derived indexes after a load; called once per behavior class.
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    onRebuild(engine, placed) {

    }
}

/**
 * A bare spawn-managed entity: no components beyond PlacedObject, no systems. Decorative/blocking
 * objects come from an ObjectType alone.
 */
export class StaticBehavior extends AbstractBehavior {

}

/**
 * A road cell: registers its footprint with the labor network; no ports, no tick.
 */
export class RoadBehavior extends AbstractBehavior {

    onSpawn(engine, placed, eid, type, message) {
        const objectId = placed.objectIdOf(eid);
        for (const cell of engine.footprint(type, message.x, message.y, message.direction)) {
            engine.labor.addRoad(cell.x, cell.y, objectId);
        }
        return [];
    }

    onDespawn(engine, placed, eid) {
        const position = engine.Position;
        for (const cell of engine.footprint(this.type, position.x[eid], position.y[eid], position.direction[eid])) {
            engine.labor.removeRoad(cell.x, cell.y);
        }
    }
}

/**
 * Whether a behavior participates in labor routing (roads, housing supply, manned machines).
 * @param {AbstractBehavior} behavior
 * @returns {boolean}
 */
export function isLaborBehavior(behavior) {
    return behavior instanceof RoadBehavior || behavior.laborSupply > 0 || behavior.laborCost > 0;
}

/**
 * A labor source: contributes laborSupply to the road component its footprint touches.
 */
export class HousingBehavior extends AbstractBehavior {

    /**
     * @param {object} config
     * @param {number} config.laborSupply
     */
    constructor({laborSupply}) {
        super();
        this.laborSupply = laborSupply;
    }

    onSpawn(engine, placed, eid, type, message) {
        engine.labor.markDirty();
        return [];
    }

    onDespawn(engine, placed, eid) {
        engine.labor.markDirty();
    }
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
     * @param {number} [config.laborCost] - labor consumed when road-connected to housing (0 = never manned)
     */
    constructor({processingTicks, recipes, fallback, laborCost=0}) {
        super();
        this.processingTicks = processingTicks;
        this.fallback = fallback;
        this.laborCost = laborCost;

        // Packed gathered-set key -> output (see _recipeKey).
        this.recipes = new Map();
        for (const recipe of recipes) {
            this.recipes.set(this._recipeKey(recipe.inputs), recipe.output);
        }
    }

    _attachType(type) {
        super._attachType(type);
        // Cached off the type: the tick loop reads it per entity, and a getter chaining through
        // type.inputPorts blocks that from folding away.
        this.inputCount = type.inputPorts.length;
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
            // The two behavior constants the submit pass reads per machine per tick. Kept on the row so
            // the pass never hops through PlacedObject to reach the behavior instance.
            {name: "inputCount"},
            {name: "processingTicks"},
            // Per-tick processing progress (1 unstaffed, MANNED_SPEED_MULTIPLIER fully staffed;
            // grants are full-crew-or-nothing); written by LaborNetworks via setLabor.
            {name: "laborStep", kind: "f32", fill: 1},
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
            machine[IN_COLS[i]][row] = engine.portFor(port, message.x, message.y, message.direction).port;
        }
        const output = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction);
        machine.out[row] = output.port;
        // Explicit: a recycled row may hold a stale step from a previous occupant.
        machine.laborStep[row] = 1;
        engine.registerRenderedPort(output.port, output.tile.x, output.tile.y);
        if (this.laborCost > 0) {
            engine.labor.markDirty();
        }
        return [output.port];
    }

    onDespawn(engine, placed, eid) {
        const def = engine.component("Machine");
        engine.unregisterRenderedPort(def.store.out[def.row(eid)]);
        if (this.laborCost > 0) {
            engine.labor.markDirty();
        }
    }

    setLabor(engine, placed, eid, granted) {
        const def = engine.component("Machine");
        def.store.laborStep[def.row(eid)] = 1 + (MANNED_SPEED_MULTIPLIER - 1) * (granted / this.laborCost);
    }

    syncData(engine, placed, eid) {
        const def = engine.component("Machine");
        const row = def.row(eid);
        const last = def.store.lastOutput[row];
        return {portIds: [def.store.out[row]], lastOutput: last === EMPTY ? null : last};
    }

    resyncRenderedPorts(engine, placed, eid) {
        const def = engine.component("Machine");
        const out = def.store.out[def.row(eid)];
        engine.registerRenderedPort(out, engine.Position.x[out], engine.Position.y[out]);
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
            inputPorts.push(resting === EMPTY ? 0 : resting);
            const slot = slotCols[i][row];
            const processing = processingCols[i][row];
            inputMemory.push(slot !== EMPTY ? slot : (processing !== EMPTY ? processing : 0));
        }
        // The wire carries whole ticks; the fractional countdown stays sim-side.
        const remaining = machine.remaining[row] === EMPTY ? null : Math.ceil(machine.remaining[row]);
        const outItem = item[machine.out[row]];
        const labor = this.laborCost > 0 ? engine.labor.inspectFor(objectId) : null;
        return new InspectHeartbeatEvent(
            objectId,
            inputPorts,
            inputMemory,
            remaining,
            this.processingTicks,
            outItem === EMPTY ? null : outItem,
            this._inspectRecipeOutput(inputMemory),
            this.laborCost > 0 ? this.laborCost : null,
            this.laborCost > 0 ? (labor === null ? 0 : labor.granted) : null,
            labor === null ? null : labor.supply,
            labor === null ? null : labor.demand,
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
        }
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
        return output === undefined ? this.fallback : output;
    }

    /**
     * @private
     * @param {ArrayLike<number>[]} slotCols
     * @param {number} row
     * @returns {number} the produced output for the gathered slots, or the fallback
     */
    _resolveRecipe(slotCols, row) {
        let key = 0;
        for (let i = 0; i < RECIPE_SLOTS; i += 1) {
            const slot = i < this.inputCount ? slotCols[i][row] : EMPTY;
            key = key * RECIPE_SLOT_LIMIT + (slot === EMPTY ? 0 : slot);
        }
        const output = this.recipes.get(key);
        if (output === undefined) {
            return this.fallback;
        }
        return output;
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
        const inputCounts = machine.inputCount;
        const processingTicks = machine.processingTicks;
        const laborStep = machine.laborStep;
        // Hoisted: `count` and `eids` reach through the descriptor into the world's membership set, and
        // this loop runs once per machine per tick.
        const eids = def.eids;
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            const step = laborStep[row];
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
            // afterwards. Filling and counting separately walked the slot columns twice.
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
                output[row] = placed.behaviorFor(placed.typeIdOf(eids[row]))._resolveRecipe(slotCols, row);
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
            }
        }
    }

    /**
     * POST_RESOLVE: a machine whose output was delivered records last_output and goes idle.
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
        for (let row = 0; row < count; row += 1) {
            if (engine.wasResolvedDest(machine.out[row])) {
                machine.lastOutput[row] = machine.output[row];
                machine.output[row] = EMPTY;
                machine.remaining[row] = EMPTY;
                for (let i = 0; i < RECIPE_SLOTS; i += 1) {
                    processingCols[i][row] = EMPTY;
                }
            }
        }
    }
}

/**
 * A resource extractor: a producer with no input port whose fixed input is the resource covered at
 * its tile (bound at spawn); it looks that up in its recipes and produces the output every
 * `processingTicks` into its one output port (a managed source-less create).
 */
export class ExtractorBehavior extends AbstractBehavior {

    /**
     * @param {object} config
     * @param {number} config.processingTicks
     * @param {RecipeDefinition[]} config.recipes - resource type (inputs[0]) -> produced item
     */
    constructor({processingTicks, recipes}) {
        super();
        this.processingTicks = processingTicks;
        this.recipes = new Map(recipes.map(recipe => [recipe.inputs[0], recipe.output]));
    }

    install(engine, placed) {
        engine.defineComponent("Extractor", [
            {name: "out", kind: "eid", fill: NO_EID},
            {name: "resourceType", fill: EMPTY},
            {name: "remaining", kind: "f32", fill: EMPTY},
            // Overshot progress banked past a finished cycle; the next cycle starts this far along.
            {name: "carry", kind: "f32"},
            {name: "output", fill: EMPTY},
            {name: "lastOutput", fill: EMPTY},
            // The countdown length, kept on the row so the submit pass reaches no behavior instance
            // while an extractor is merely counting down.
            {name: "processingTicks"},
        ], {sparse: true});
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => ExtractorBehavior._submitIntents(engine, placed));
        engine.registerSystem(TickPhase.POST_RESOLVE, () => ExtractorBehavior._finish(engine, placed));
    }

    /**
     * Spawns only on a covered extraction tile.
     * @returns {boolean}
     */
    canSpawn(engine, placed, type, message) {
        return engine.occupantUserDataAt(message.x, message.y, LAYER_RESOURCE) !== null;
    }

    onSpawn(engine, placed, eid, type, message) {
        const def = engine.component("Extractor");
        engine.attachComponent(def, eid);
        const extractor = def.store;
        const row = def.row(eid);
        const output = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction);
        extractor.out[row] = output.port;
        extractor.processingTicks[row] = this.processingTicks;
        extractor.resourceType[row] = engine.occupantUserDataAt(message.x, message.y, LAYER_RESOURCE);
        engine.registerRenderedPort(output.port, output.tile.x, output.tile.y);
        return [output.port];
    }

    onDespawn(engine, placed, eid) {
        const def = engine.component("Extractor");
        engine.unregisterRenderedPort(def.store.out[def.row(eid)]);
    }

    syncData(engine, placed, eid) {
        const def = engine.component("Extractor");
        const row = def.row(eid);
        const last = def.store.lastOutput[row];
        return {portIds: [def.store.out[row]], lastOutput: last === EMPTY ? null : last};
    }

    resyncRenderedPorts(engine, placed, eid) {
        const def = engine.component("Extractor");
        const out = def.store.out[def.row(eid)];
        engine.registerRenderedPort(out, engine.Position.x[out], engine.Position.y[out]);
    }

    /**
     * The extractor's inspect snapshot; the bound resource shows as the sole (memory) input.
     * @returns {InspectHeartbeatEvent}
     */
    inspect(engine, placed, eid, objectId) {
        const def = engine.component("Extractor");
        const extractor = def.store;
        const row = def.row(eid);
        const resource = extractor.resourceType[row];
        // The wire carries whole ticks; the fractional countdown stays sim-side.
        const remaining = extractor.remaining[row] === EMPTY ? null : Math.ceil(extractor.remaining[row]);
        const outItem = engine.Port.item[extractor.out[row]];
        let recipeOutput = null;
        if (resource !== EMPTY && this.recipes.has(resource)) {
            recipeOutput = this.recipes.get(resource);
        }
        return new InspectHeartbeatEvent(
            objectId,
            [0],
            [resource === EMPTY ? 0 : resource],
            remaining,
            this.processingTicks,
            outItem === EMPTY ? null : outItem,
            recipeOutput,
        );
    }

    /**
     * Restores the denormalized countdown length after a load (see MachineBehavior#onRebuild).
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    onRebuild(engine, placed) {
        const def = engine.component("Extractor");
        const extractor = def.store;
        const eids = def.eids;
        for (let row = 0; row < def.count; row += 1) {
            extractor.processingTicks[row] = placed.behaviorFor(placed.typeIdOf(eids[row])).processingTicks;
        }
    }

    /**
     * SUBMIT_INTENTS: countdown; an idle extractor bound to a producing resource starts its countdown;
     * at zero it creates the output into its port.
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    static _submitIntents(engine, placed) {
        const item = engine.Port.item;
        const def = engine.component("Extractor");
        const extractor = def.store;
        const eids = def.eids;
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            if (extractor.remaining[row] > 0) {
                const next = extractor.remaining[row] - 1;
                if (next > 0) {
                    extractor.remaining[row] = next;
                } else {
                    // Bank the overshoot; the next cycle starts that far along.
                    extractor.carry[row] -= next;
                    extractor.remaining[row] = 0;
                }
            }
            // Only an idle extractor bound to a resource needs its recipe table, so the behavior hop
            // stays off the countdown path.
            if (extractor.output[row] === EMPTY && extractor.resourceType[row] !== EMPTY) {
                const behavior = placed.behaviorFor(placed.typeIdOf(eids[row]));
                if (behavior.recipes.has(extractor.resourceType[row])) {
                    extractor.output[row] = behavior.recipes.get(extractor.resourceType[row]);
                    const start = extractor.processingTicks[row] - extractor.carry[row];
                    if (start > 0) {
                        extractor.remaining[row] = start;
                        extractor.carry[row] = 0;
                    } else {
                        // Banked progress covers the whole cycle; the surplus keeps carrying.
                        extractor.remaining[row] = 0;
                        extractor.carry[row] = -start;
                    }
                }
            }
            if (extractor.remaining[row] === 0) {
                engine.submitCreate(extractor.out[row], extractor.output[row], item[extractor.out[row]] === EMPTY);
            }
        }
    }

    /**
     * POST_RESOLVE: a delivered extractor records last_output and goes idle (ready to produce again).
     * @private
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @returns {void}
     */
    static _finish(engine, placed) {
        const def = engine.component("Extractor");
        const extractor = def.store;
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            if (engine.wasResolvedDest(extractor.out[row])) {
                extractor.lastOutput[row] = extractor.output[row];
                extractor.output[row] = EMPTY;
                extractor.remaining[row] = EMPTY;
            }
        }
    }
}

/**
 * A resource body: no components beyond PlacedObject and no tick — it occupies its extraction tiles
 * on the resource layer, storing its resource type as the cell value (read by extractors at spawn),
 * and renders as a sprite. The owner-keyed cells are freed generically on delete (untrack).
 */
export class ResourceBehavior extends AbstractBehavior {

    /**
     * @param {object} config
     * @param {number} config.resourceType
     */
    constructor({resourceType}) {
        super();
        this.resourceType = resourceType;
    }

    install(engine, placed) {
        engine.registerPositionLayer(LAYER_RESOURCE);
    }

    onSpawn(engine, placed, eid, type, message) {
        const objectId = placed.objectIdOf(eid);
        const cells = type.extractionTiles.map(offset => ({
            x: message.x + offset.x,
            y: message.y + offset.y,
            layer: LAYER_RESOURCE,
        }));
        engine.occupy(cells, objectId, this.resourceType);
        return [];
    }
}
