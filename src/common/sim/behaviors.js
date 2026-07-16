import {chunkId} from "@/common/util.js";
import {InspectHeartbeatEvent} from "@/common/InspectEvents.js";
import {EMPTY, NO_EID, TickPhase} from "@/common/sim/GameEngine.js";
import {ResourceCoverService} from "@/common/sim/services.js";

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
            {name: "outTileX"},
            {name: "outTileY"},
        ]);
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => MachineBehavior._submitIntents(engine, placed));
        engine.registerSystem(TickPhase.POST_RESOLVE, () => MachineBehavior._finish(engine, placed));
    }

    onSpawn(engine, placed, eid, type, message) {
        engine.attachComponent(engine.component("Machine"), eid);
        const M = engine.component("Machine").store;
        type.inputPorts.forEach((port, i) => {
            M[IN_COLS[i]][eid] = engine.portFor(port, message.x, message.y, message.direction).port;
        });
        const output = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction);
        M.out[eid] = output.port;
        M.outTileX[eid] = output.tile.x;
        M.outTileY[eid] = output.tile.y;
        engine.registerRenderedPort(output.port, output.tile.x, output.tile.y);
        return [output.port];
    }

    onDespawn(engine, placed, eid) {
        const M = engine.component("Machine").store;
        engine.unregisterRenderedPort(M.out[eid]);
    }

    syncData(engine, placed, eid) {
        const M = engine.component("Machine").store;
        const last = M.lastOutput[eid];
        return {portIds: [M.out[eid]], lastOutput: last === EMPTY ? null : last};
    }

    resyncRenderedPorts(engine, placed, eid) {
        const M = engine.component("Machine").store;
        engine.registerRenderedPort(M.out[eid], M.outTileX[eid], M.outTileY[eid]);
    }

    /**
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {number} eid
     * @param {number} objectId
     * @returns {InspectHeartbeatEvent}
     */
    inspect(engine, placed, eid, objectId) {
        const P = engine.Port.item;
        const M = engine.component("Machine").store;
        const inputPorts = [];
        const inputMemory = [];
        for (let i = 0; i < this.inputCount; i += 1) {
            const resting = P[M[IN_COLS[i]][eid]];
            inputPorts.push(resting === EMPTY ? 0 : resting);
            const slot = M[SLOT_COLS[i]][eid];
            const processing = M[PROCESSING_COLS[i]][eid];
            inputMemory.push(slot !== EMPTY ? slot : (processing !== EMPTY ? processing : 0));
        }
        const remaining = M.remaining[eid] === EMPTY ? null : M.remaining[eid];
        const outItem = P[M.out[eid]];
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
     * @param {object} M - the Machine store
     * @param {number} eid
     * @returns {number} the produced output for the gathered slots, or the fallback
     */
    _resolveRecipe(M, eid) {
        const key = [];
        for (let i = 0; i < RECIPE_SLOTS; i += 1) {
            const slot = i < this.inputCount ? M[SLOT_COLS[i]][eid] : EMPTY;
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
        const P = engine.Port.item;
        const def = engine.component("Machine");
        const M = def.store;
        engine.entitiesWith(def).forEach(eid => {
            const behavior = placed.behaviorFor(placed.PlacedObject.typeId[eid]);
            if (M.remaining[eid] > 0) {
                M.remaining[eid] -= 1;
            }

            // Gather while idle, or in step on the tick a free output lets the next set load.
            const gathering = M.output[eid] === EMPTY || (M.remaining[eid] === 0 && P[M.out[eid]] === EMPTY);
            if (gathering) {
                for (let i = 0; i < behavior.inputCount; i += 1) {
                    const inPort = M[IN_COLS[i]][eid];
                    if (M[SLOT_COLS[i]][eid] === EMPTY && P[inPort] !== EMPTY) {
                        engine.submitIntent({source: inPort, dest: EMPTY, managed: true});
                        M[SLOT_COLS[i]][eid] = P[inPort];
                    }
                }
            }

            // Every port contributed: match the recipe, start the countdown, move slots into processing.
            let allFilled = M.output[eid] === EMPTY;
            for (let i = 0; i < behavior.inputCount; i += 1) {
                if (M[SLOT_COLS[i]][eid] === EMPTY) {
                    allFilled = false;
                }
            }
            if (allFilled) {
                M.output[eid] = behavior._resolveRecipe(M, eid);
                M.remaining[eid] = behavior.processingTicks;
                for (let i = 0; i < behavior.inputCount; i += 1) {
                    M[PROCESSING_COLS[i]][eid] = M[SLOT_COLS[i]][eid];
                    M[SLOT_COLS[i]][eid] = EMPTY;
                }
            }

            if (M.remaining[eid] === 0) {
                engine.submitIntent({
                    source: EMPTY,
                    dest: M.out[eid],
                    destEmpty: P[M.out[eid]] === EMPTY,
                    outputItem: M.output[eid],
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
        const M = def.store;
        engine.entitiesWith(def).forEach(eid => {
            if (engine.wasResolvedDest(M.out[eid])) {
                M.lastOutput[eid] = M.output[eid];
                M.output[eid] = EMPTY;
                M.remaining[eid] = EMPTY;
                for (let i = 0; i < RECIPE_SLOTS; i += 1) {
                    M[PROCESSING_COLS[i]][eid] = EMPTY;
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
            {name: "outTileX"},
            {name: "outTileY"},
        ]);
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => ExtractorBehavior._submitIntents(engine, placed));
        engine.registerSystem(TickPhase.POST_RESOLVE, () => ExtractorBehavior._finish(engine, placed));
    }

    /**
     * Spawns only on a covered extraction tile.
     * @returns {boolean}
     */
    canSpawn(engine, placed, type, message) {
        return engine.resolve(ResourceCoverService).coverAt(message.x, message.y) !== null;
    }

    onSpawn(engine, placed, eid, type, message) {
        engine.attachComponent(engine.component("Extractor"), eid);
        const E = engine.component("Extractor").store;
        const output = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction);
        E.out[eid] = output.port;
        E.resourceType[eid] = engine.resolve(ResourceCoverService).coverAt(message.x, message.y);
        E.outTileX[eid] = output.tile.x;
        E.outTileY[eid] = output.tile.y;
        engine.registerRenderedPort(output.port, output.tile.x, output.tile.y);
        return [output.port];
    }

    onDespawn(engine, placed, eid) {
        const E = engine.component("Extractor").store;
        engine.unregisterRenderedPort(E.out[eid]);
    }

    syncData(engine, placed, eid) {
        const E = engine.component("Extractor").store;
        const last = E.lastOutput[eid];
        return {portIds: [E.out[eid]], lastOutput: last === EMPTY ? null : last};
    }

    resyncRenderedPorts(engine, placed, eid) {
        const E = engine.component("Extractor").store;
        engine.registerRenderedPort(E.out[eid], E.outTileX[eid], E.outTileY[eid]);
    }

    /**
     * The extractor's inspect snapshot; the bound resource shows as the sole (memory) input.
     * @returns {InspectHeartbeatEvent}
     */
    inspect(engine, placed, eid, objectId) {
        const E = engine.component("Extractor").store;
        const resource = E.resourceType[eid];
        const remaining = E.remaining[eid] === EMPTY ? null : E.remaining[eid];
        const outItem = engine.Port.item[E.out[eid]];
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
        const P = engine.Port.item;
        const def = engine.component("Extractor");
        const E = def.store;
        engine.entitiesWith(def).forEach(eid => {
            const behavior = placed.behaviorFor(placed.PlacedObject.typeId[eid]);
            if (E.remaining[eid] > 0) {
                E.remaining[eid] -= 1;
            }
            if (E.output[eid] === EMPTY && E.resourceType[eid] !== EMPTY && behavior.recipes.has(E.resourceType[eid])) {
                E.output[eid] = behavior.recipes.get(E.resourceType[eid]);
                E.remaining[eid] = behavior.processingTicks;
            }
            if (E.remaining[eid] === 0) {
                engine.submitIntent({
                    source: EMPTY,
                    dest: E.out[eid],
                    destEmpty: P[E.out[eid]] === EMPTY,
                    outputItem: E.output[eid],
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
        const E = def.store;
        engine.entitiesWith(def).forEach(eid => {
            if (engine.wasResolvedDest(E.out[eid])) {
                E.lastOutput[eid] = E.output[eid];
                E.output[eid] = EMPTY;
                E.remaining[eid] = EMPTY;
            }
        });
    }
}

/**
 * A resource body: no components beyond PlacedObject and no tick — it spawns ResourceCover entities
 * on its extraction tiles (read by extractors at spawn) and renders as a sprite.
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
        const def = engine.defineComponent("ResourceCover", [
            {name: "x"},
            {name: "y"},
            {name: "resourceType"},
            {name: "owner", fill: NO_EID},
        ]);
        engine.provide(ResourceCoverService, new ResourceCoverService(engine, def));
    }

    onSpawn(engine, placed, eid, type, message) {
        const covers = engine.resolve(ResourceCoverService);
        const clientId = placed.PlacedObject.clientId[eid];
        type.extractionTiles.forEach(offset => {
            covers.addCover(message.x + offset.x, message.y + offset.y, this.resourceType, clientId);
        });
        return [];
    }

    onDespawn(engine, placed, eid) {
        engine.resolve(ResourceCoverService).removeOwner(placed.PlacedObject.clientId[eid]);
    }

    onRebuild(engine, placed) {
        engine.resolve(ResourceCoverService).rebuild();
    }
}
