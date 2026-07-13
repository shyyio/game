import {TickPhase} from "@/common/core.js";
import {chunkId} from "@/common/util.js";
import {EasyObjectInsertEvent, EasyObjectSyncEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";
import {InspectHeartbeatEvent} from "@/common/InspectEvents.js";
import {EMPTY, NO_EID} from "@/common/sim/EcsEngine.js";

// Recipe input keys are always padded to three slots.
const RECIPE_SLOTS = 3;

// Per-slot column names, indexed 0..RECIPE_SLOTS-1.
const IN_COLS = ["in0", "in1", "in2"];
const SLOT_COLS = ["slot0", "slot1", "slot2"];
const PROCESSING_COLS = ["processing0", "processing1", "processing2"];

/**
 * The EasyRecipeProcessor machine on the bitECS engine: each input port gathers one item (consumed
 * via a managed sink), and once every port has contributed the gathered slots match the verb's
 * recipes (fallback when none), producing the output `processingTicks` later into the output port (a
 * managed source-less create). All state lives in the registered Machine component, so it serializes
 * with no bespoke save code.
 */
export class MachineModule {

    /**
     * @param {EcsEngine} engine
     * @param {object} config
     * @param {number} config.processingTicks
     * @param {number} config.inputCount - number of active input ports (1..3)
     * @param {{inputs:number[], output:number}[]} config.recipes
     * @param {number} config.fallback - output when the gathered set matches no recipe
     * @param {number} config.typeId - the single object type this module places
     * @param {string} [config.name] - component name (unique per module instance)
     */
    constructor(engine, {processingTicks, inputCount, recipes, fallback, typeId, name="Machine"}) {
        this.engine = engine;
        this.processingTicks = processingTicks;
        this.inputCount = inputCount;
        this.fallback = fallback;
        this.typeId = typeId;

        // Gathered-set key "i1,i2,i3" -> output.
        this.recipes = new Map();
        recipes.forEach(recipe => {
            this.recipes.set(this._recipeKey(recipe.inputs), recipe.output);
        });

        this.def = engine.defineComponent(name, [
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
            {name: "clientId", fill: NO_EID},
            {name: "x"},
            {name: "y"},
            {name: "direction"},
            {name: "outTileX"},
            {name: "outTileY"},
        ]);
        this.Machine = this.def.store;

        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._submitIntents());
        engine.registerSystem(TickPhase.POST_RESOLVE, () => this._finish());
        engine.registerRebuildHook(() => this._resync());
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

    /**
     * The placed machine entities.
     * @returns {number[]}
     */
    eids() {
        return this.engine.entitiesWith(this.def);
    }

    /**
     * The machine entity with client id `clientId`, or undefined.
     * @param {number} clientId
     * @returns {number|undefined}
     */
    eidByClientId(clientId) {
        return this.eids().find(eid => this.Machine.clientId[eid] === clientId);
    }

    /**
     * Creates a machine. Its ports are fresh unless given: `wiring.inputs` reuses existing ports as
     * inputs (e.g. an upstream belt's out-port) and `wiring.out` reuses one as the output.
     * @param {{inputs?:number[], out?:number}} [wiring]
     * @returns {{id:number, inputs:number[], out:number}}
     */
    addMachine(wiring={}) {
        const inputs = [];
        for (let i = 0; i < this.inputCount; i += 1) {
            const given = wiring.inputs === undefined ? undefined : wiring.inputs[i];
            inputs.push(given === undefined ? this.engine.createPort() : given);
        }
        const out = wiring.out === undefined ? this.engine.createPort() : wiring.out;

        const eid = this.engine.createEntity(this.def);
        inputs.forEach((port, i) => {
            this.Machine[IN_COLS[i]][eid] = port;
        });
        this.Machine.out[eid] = out;

        return {id: eid, inputs, out};
    }

    /**
     * Places a client-visible machine at (x, y) wired to the given input/output ports (adopted from
     * adjacent belts by the caller), emitting an EasyObjectInsertEvent and drawing its output item at
     * `outTile`.
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {number[]} inputPorts
     * @param {number} outPort
     * @param {{x:number, y:number}} outTile
     * @returns {{id:number, inputs:number[], out:number}}
     */
    placeMachine(x, y, direction, inputPorts, outPort, outTile) {
        const handle = this.addMachine({inputs: inputPorts, out: outPort});
        const clientId = this.engine.createObjectId();
        handle.clientId = clientId;
        const M = this.Machine;
        M.clientId[handle.id] = clientId;
        M.x[handle.id] = x;
        M.y[handle.id] = y;
        M.direction[handle.id] = direction;
        M.outTileX[handle.id] = outTile.x;
        M.outTileY[handle.id] = outTile.y;
        this.engine.registerRenderedPort(outPort, outTile.x, outTile.y);
        this.engine.emitEvent(new EasyObjectInsertEvent(this.typeId, clientId, x, y, direction, [outPort], null));
        return handle;
    }

    /**
     * The EasyObjectSyncEvents recreating this module's machines in `chunk`.
     * @param {number} chunk
     * @returns {EasyObjectSyncEvent[]}
     */
    chunkSync(chunk) {
        const events = [];
        const M = this.Machine;
        this.eids().forEach(eid => {
            if (chunkId(M.x[eid], M.y[eid]) === chunk) {
                const last = M.lastOutput[eid];
                events.push(new EasyObjectSyncEvent(
                    this.typeId, M.clientId[eid], M.x[eid], M.y[eid], M.direction[eid],
                    [M.out[eid]], last === EMPTY ? null : last,
                ));
            }
        });
        return events;
    }

    /**
     * Removes the machine with client id `clientId`, if any.
     * @param {number} clientId
     * @returns {boolean}
     */
    removeMachineById(clientId) {
        const eid = this.eidByClientId(clientId);
        if (eid === undefined) {
            return false;
        }
        const M = this.Machine;
        this.engine.unregisterRenderedPort(M.out[eid]);
        this.engine.emitEvent(new EasyObjectDeleteEvent(this.typeId, clientId, M.x[eid], M.y[eid]));
        this.engine.destroyEntity(eid);
        return true;
    }

    /**
     * Re-registers every machine's rendered out-port after a load repopulates the world.
     * @private
     * @returns {void}
     */
    _resync() {
        const M = this.Machine;
        this.eids().forEach(eid => {
            this.engine.registerRenderedPort(M.out[eid], M.outTileX[eid], M.outTileY[eid]);
        });
    }

    /**
     * The machine's current inspect snapshot, or null if no machine has that client id.
     * @param {number} clientId
     * @returns {InspectHeartbeatEvent|null}
     */
    inspect(clientId) {
        const eid = this.eidByClientId(clientId);
        if (eid === undefined) {
            return null;
        }
        const P = this.engine.Port.item;
        const M = this.Machine;
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
            clientId,
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
     * @param {number} eid
     * @returns {number} the produced output for the gathered slots, or the fallback
     */
    _resolveRecipe(eid) {
        const key = [];
        for (let i = 0; i < RECIPE_SLOTS; i += 1) {
            const slot = i < this.inputCount ? this.Machine[SLOT_COLS[i]][eid] : EMPTY;
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
     * resolve a full slot set into processing_output + countdown, then create the output when the
     * countdown reaches zero. Processed per machine (machines never share ports).
     * @private
     * @returns {void}
     */
    _submitIntents() {
        const P = this.engine.Port.item;
        const M = this.Machine;
        this.eids().forEach(eid => {
            if (M.remaining[eid] > 0) {
                M.remaining[eid] -= 1;
            }

            // Gather while idle, or in step on the tick a free output lets the next set load.
            const gathering = M.output[eid] === EMPTY || (M.remaining[eid] === 0 && P[M.out[eid]] === EMPTY);
            if (gathering) {
                for (let i = 0; i < this.inputCount; i += 1) {
                    const inPort = M[IN_COLS[i]][eid];
                    if (M[SLOT_COLS[i]][eid] === EMPTY && P[inPort] !== EMPTY) {
                        this.engine.submitIntent({source: inPort, dest: EMPTY, managed: true});
                        M[SLOT_COLS[i]][eid] = P[inPort];
                    }
                }
            }

            // Every port contributed: match the recipe, start the countdown, move slots into processing.
            let allFilled = M.output[eid] === EMPTY;
            for (let i = 0; i < this.inputCount; i += 1) {
                if (M[SLOT_COLS[i]][eid] === EMPTY) {
                    allFilled = false;
                }
            }
            if (allFilled) {
                M.output[eid] = this._resolveRecipe(eid);
                M.remaining[eid] = this.processingTicks;
                for (let i = 0; i < this.inputCount; i += 1) {
                    M[PROCESSING_COLS[i]][eid] = M[SLOT_COLS[i]][eid];
                    M[SLOT_COLS[i]][eid] = EMPTY;
                }
            }

            if (M.remaining[eid] === 0) {
                this.engine.submitIntent({
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
     * @returns {void}
     */
    _finish() {
        const M = this.Machine;
        this.eids().forEach(eid => {
            if (this.engine.wasResolvedDest(M.out[eid])) {
                M.lastOutput[eid] = M.output[eid];
                M.output[eid] = EMPTY;
                M.remaining[eid] = EMPTY;
                for (let i = 0; i < this.inputCount; i += 1) {
                    M[PROCESSING_COLS[i]][eid] = EMPTY;
                }
            }
        });
    }
}
