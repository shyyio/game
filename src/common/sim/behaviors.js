import {chunkId} from "@/common/util.js";
import {InspectHeartbeatEvent} from "@/common/InspectEvents.js";
import {EMPTY, NO_EID, TickPhase} from "@/common/sim/GameEngine.js";

// Position layer for resource cover: an extraction tile stores its resource type as the cell userData.
const LAYER_RESOURCE = "R";

// Recipe input keys are always padded to three slots.
const RECIPE_SLOTS = 3;

// Per-slot column names, indexed 0..RECIPE_SLOTS-1.
const IN_COLS = ["in0", "in1", "in2"];
const SLOT_COLS = ["slot0", "slot1", "slot2"];
const PROCESSING_COLS = ["processing0", "processing1", "processing2"];

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
     */
    constructor({processingTicks, recipes, fallback}) {
        super();
        this.processingTicks = processingTicks;
        this.fallback = fallback;

        // Gathered-set key "i1,i2,i3" -> output.
        this.recipes = new Map();
        recipes.forEach(recipe => {
            this.recipes.set(this._recipeKey(recipe.inputs), recipe.output);
        });
    }

    /**
     * @returns {number}
     */
    get inputCount() {
        return this.type.inputPorts.length;
    }

    /**
     * @private
     * @param {number[]} inputs
     * @returns {string}
     */
    _recipeKey(inputs) {
        const padded = [...inputs];
        while (padded.length < RECIPE_SLOTS) {
            padded.push(0);
        }
        return padded.join(",");
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
            {name: "remaining", fill: EMPTY},
            {name: "output", fill: EMPTY},
            {name: "lastOutput", fill: EMPTY},
        ]);
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => MachineBehavior._submitIntents(engine, placed));
        engine.registerSystem(TickPhase.POST_RESOLVE, () => MachineBehavior._finish(engine, placed));
    }

    onSpawn(engine, placed, eid, type, message) {
        engine.attachComponent(engine.component("Machine"), eid);
        const machine = engine.component("Machine").store;
        type.inputPorts.forEach((port, i) => {
            machine[IN_COLS[i]][eid] = engine.portFor(port, message.x, message.y, message.direction).port;
        });
        const output = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction);
        machine.out[eid] = output.port;
        engine.registerRenderedPort(output.port, output.tile.x, output.tile.y);
        return [output.port];
    }

    onDespawn(engine, placed, eid) {
        const machine = engine.component("Machine").store;
        engine.unregisterRenderedPort(machine.out[eid]);
    }

    syncData(engine, placed, eid) {
        const machine = engine.component("Machine").store;
        const last = machine.lastOutput[eid];
        return {portIds: [machine.out[eid]], lastOutput: last === EMPTY ? null : last};
    }

    resyncRenderedPorts(engine, placed, eid) {
        const out = engine.component("Machine").store.out[eid];
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
        const machine = engine.component("Machine").store;
        const inputPorts = [];
        const inputMemory = [];
        for (let i = 0; i < this.inputCount; i += 1) {
            const resting = item[machine[IN_COLS[i]][eid]];
            inputPorts.push(resting === EMPTY ? 0 : resting);
            const slot = machine[SLOT_COLS[i]][eid];
            const processing = machine[PROCESSING_COLS[i]][eid];
            inputMemory.push(slot !== EMPTY ? slot : (processing !== EMPTY ? processing : 0));
        }
        const remaining = machine.remaining[eid] === EMPTY ? null : machine.remaining[eid];
        const outItem = item[machine.out[eid]];
        return new InspectHeartbeatEvent(
            objectId,
            inputPorts,
            inputMemory,
            remaining,
            this.processingTicks,
            outItem === EMPTY ? null : outItem,
            this._inspectRecipeOutput(inputMemory),
        );
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
        const key = [];
        for (let i = 0; i < RECIPE_SLOTS; i += 1) {
            key.push(i < inputMemory.length ? inputMemory[i] : 0);
        }
        const output = this.recipes.get(key.join(","));
        return output === undefined ? this.fallback : output;
    }

    /**
     * @private
     * @param {object} machine - the Machine store
     * @param {number} eid
     * @returns {number} the produced output for the gathered slots, or the fallback
     */
    _resolveRecipe(machine, eid) {
        const key = [];
        for (let i = 0; i < RECIPE_SLOTS; i += 1) {
            const slot = i < this.inputCount ? machine[SLOT_COLS[i]][eid] : EMPTY;
            key.push(slot === EMPTY ? 0 : slot);
        }
        const output = this.recipes.get(key.join(","));
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
        engine.entitiesWith(def).forEach(eid => {
            const behavior = placed.behaviorFor(placed.PlacedObject.typeId[eid]);
            if (machine.remaining[eid] > 0) {
                machine.remaining[eid] -= 1;
            }

            // Gather while idle, or in step on the tick a free output lets the next set load.
            const gathering = machine.output[eid] === EMPTY || (machine.remaining[eid] === 0 && item[machine.out[eid]] === EMPTY);
            if (gathering) {
                for (let i = 0; i < behavior.inputCount; i += 1) {
                    const inPort = machine[IN_COLS[i]][eid];
                    if (machine[SLOT_COLS[i]][eid] === EMPTY && item[inPort] !== EMPTY) {
                        engine.submitIntent({source: inPort, dest: EMPTY, managed: true});
                        machine[SLOT_COLS[i]][eid] = item[inPort];
                    }
                }
            }

            // Every port contributed: match the recipe, start the countdown, move slots into processing.
            let allFilled = machine.output[eid] === EMPTY;
            for (let i = 0; i < behavior.inputCount; i += 1) {
                if (machine[SLOT_COLS[i]][eid] === EMPTY) {
                    allFilled = false;
                }
            }
            if (allFilled) {
                machine.output[eid] = behavior._resolveRecipe(machine, eid);
                machine.remaining[eid] = behavior.processingTicks;
                for (let i = 0; i < behavior.inputCount; i += 1) {
                    machine[PROCESSING_COLS[i]][eid] = machine[SLOT_COLS[i]][eid];
                    machine[SLOT_COLS[i]][eid] = EMPTY;
                }
            }

            if (machine.remaining[eid] === 0) {
                engine.submitIntent({
                    source: EMPTY,
                    dest: machine.out[eid],
                    destEmpty: item[machine.out[eid]] === EMPTY,
                    outputItem: machine.output[eid],
                    managed: true,
                });
            }
        });
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
        engine.entitiesWith(def).forEach(eid => {
            if (engine.wasResolvedDest(machine.out[eid])) {
                machine.lastOutput[eid] = machine.output[eid];
                machine.output[eid] = EMPTY;
                machine.remaining[eid] = EMPTY;
                for (let i = 0; i < RECIPE_SLOTS; i += 1) {
                    machine[PROCESSING_COLS[i]][eid] = EMPTY;
                }
            }
        });
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
            {name: "remaining", fill: EMPTY},
            {name: "output", fill: EMPTY},
            {name: "lastOutput", fill: EMPTY},
        ]);
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
        engine.attachComponent(engine.component("Extractor"), eid);
        const extractor = engine.component("Extractor").store;
        const output = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction);
        extractor.out[eid] = output.port;
        extractor.resourceType[eid] = engine.occupantUserDataAt(message.x, message.y, LAYER_RESOURCE);
        engine.registerRenderedPort(output.port, output.tile.x, output.tile.y);
        return [output.port];
    }

    onDespawn(engine, placed, eid) {
        const extractor = engine.component("Extractor").store;
        engine.unregisterRenderedPort(extractor.out[eid]);
    }

    syncData(engine, placed, eid) {
        const extractor = engine.component("Extractor").store;
        const last = extractor.lastOutput[eid];
        return {portIds: [extractor.out[eid]], lastOutput: last === EMPTY ? null : last};
    }

    resyncRenderedPorts(engine, placed, eid) {
        const out = engine.component("Extractor").store.out[eid];
        engine.registerRenderedPort(out, engine.Position.x[out], engine.Position.y[out]);
    }

    /**
     * The extractor's inspect snapshot; the bound resource shows as the sole (memory) input.
     * @returns {InspectHeartbeatEvent}
     */
    inspect(engine, placed, eid, objectId) {
        const extractor = engine.component("Extractor").store;
        const resource = extractor.resourceType[eid];
        const remaining = extractor.remaining[eid] === EMPTY ? null : extractor.remaining[eid];
        const outItem = engine.Port.item[extractor.out[eid]];
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
        engine.entitiesWith(def).forEach(eid => {
            const behavior = placed.behaviorFor(placed.PlacedObject.typeId[eid]);
            if (extractor.remaining[eid] > 0) {
                extractor.remaining[eid] -= 1;
            }
            if (extractor.output[eid] === EMPTY && extractor.resourceType[eid] !== EMPTY && behavior.recipes.has(extractor.resourceType[eid])) {
                extractor.output[eid] = behavior.recipes.get(extractor.resourceType[eid]);
                extractor.remaining[eid] = behavior.processingTicks;
            }
            if (extractor.remaining[eid] === 0) {
                engine.submitIntent({
                    source: EMPTY,
                    dest: extractor.out[eid],
                    destEmpty: item[extractor.out[eid]] === EMPTY,
                    outputItem: extractor.output[eid],
                    managed: true,
                });
            }
        });
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
        engine.entitiesWith(def).forEach(eid => {
            if (engine.wasResolvedDest(extractor.out[eid])) {
                extractor.lastOutput[eid] = extractor.output[eid];
                extractor.output[eid] = EMPTY;
                extractor.remaining[eid] = EMPTY;
            }
        });
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
        const clientId = placed.PlacedObject.clientId[eid];
        const cells = type.extractionTiles.map(offset => ({
            x: message.x + offset.x,
            y: message.y + offset.y,
            layer: LAYER_RESOURCE,
        }));
        engine.occupy(cells, clientId, this.resourceType);
        return [];
    }
}
