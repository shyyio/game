import {addEntity, addComponent} from "bitecs";
import {TickPhase} from "@/common/core.js";
import {chunkId} from "@/common/util.js";
import {EasyObjectInsertEvent, EasyObjectSyncEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";
import {InspectHeartbeatEvent} from "@/common/InspectEvents.js";
import {EMPTY} from "@/common/sim/EcsEngine.js";

// Initial Machine column length; grows by doubling when a machine eid exceeds it.
const MACHINE_CAPACITY = 256;

// Recipe input keys are always padded to three slots (matching the SQL Recipes table).
const RECIPE_SLOTS = 3;

/**
 * The EasyRecipeProcessor machine on the bitECS engine: each input port gathers one item (consumed
 * via a managed sink), and once every port has contributed the gathered slots match the verb's
 * recipes (fallback when none), producing the output `processingTicks` later into the output port (a
 * managed source-less create). Mirrors the SQL producer + recipe-processor tick ops.
 */
export class MachineModule {

    /**
     * @param {EcsEngine} engine
     * @param {object} config
     * @param {number} config.processingTicks
     * @param {number} config.inputCount - number of active input ports (1..3)
     * @param {{inputs:number[], output:number}[]} config.recipes
     * @param {number} config.fallback - output when the gathered set matches no recipe
     */
    constructor(engine, {processingTicks, inputCount, recipes, fallback}) {
        this.engine = engine;
        this.processingTicks = processingTicks;
        this.inputCount = inputCount;
        this.fallback = fallback;

        // Gathered-set key "i1,i2,i3" -> output.
        this.recipes = new Map();
        recipes.forEach(recipe => {
            this.recipes.set(this._recipeKey(recipe.inputs), recipe.output);
        });

        this.Machine = {
            out: new Int32Array(MACHINE_CAPACITY),
            remaining: new Int32Array(MACHINE_CAPACITY).fill(EMPTY),
            output: new Int32Array(MACHINE_CAPACITY).fill(EMPTY),
            lastOutput: new Int32Array(MACHINE_CAPACITY).fill(EMPTY),
            in: [0, 0, 0].map(() => new Int32Array(MACHINE_CAPACITY).fill(EMPTY)),
            slot: [0, 0, 0].map(() => new Int32Array(MACHINE_CAPACITY).fill(EMPTY)),
            // The consumed batch, kept through processing (cleared on finish) for the inspect menu.
            batch: [0, 0, 0].map(() => new Int32Array(MACHINE_CAPACITY).fill(EMPTY)),
        };
        this._capacity = MACHINE_CAPACITY;
        this.ids = [];
        // eid -> {clientId, typeId, x, y, direction, outPort, outTile} for placed machines.
        this._meta = new Map();
        // clientId -> eid.
        this._byClientId = new Map();

        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._submitIntents());
        engine.registerSystem(TickPhase.POST_RESOLVE, () => this._finish());
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
     * @private
     * @param {number} eid
     * @returns {void}
     */
    _ensureCapacity(eid) {
        if (eid < this._capacity) {
            return;
        }
        let capacity = this._capacity;
        while (capacity <= eid) {
            capacity *= 2;
        }
        const grow = (array, fill) => {
            const grown = new Int32Array(capacity).fill(fill);
            grown.set(array);
            return grown;
        };
        this.Machine.out = grow(this.Machine.out, 0);
        this.Machine.remaining = grow(this.Machine.remaining, EMPTY);
        this.Machine.output = grow(this.Machine.output, EMPTY);
        this.Machine.lastOutput = grow(this.Machine.lastOutput, EMPTY);
        this.Machine.in = this.Machine.in.map(array => grow(array, EMPTY));
        this.Machine.slot = this.Machine.slot.map(array => grow(array, EMPTY));
        this.Machine.batch = this.Machine.batch.map(array => grow(array, EMPTY));
        this._capacity = capacity;
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
            inputs.push(given === undefined ? this.engine.addPort() : given);
        }
        const out = wiring.out === undefined ? this.engine.addPort() : wiring.out;

        const eid = addEntity(this.engine.world);
        addComponent(this.engine.world, eid, this.Machine);
        this._ensureCapacity(eid);

        inputs.forEach((port, i) => {
            this.Machine.in[i][eid] = port;
        });
        this.Machine.out[eid] = out;
        this.ids.push(eid);

        return {id: eid, inputs, out};
    }

    /**
     * Places a client-visible machine at (x, y) wired to the given input/output ports (adopted from
     * adjacent belts by the caller), emitting an EasyObjectInsertEvent and drawing its output item at
     * `outTile`.
     * @param {number} x
     * @param {number} y
     * @param {number} typeId
     * @param {Direction} direction
     * @param {number[]} inputPorts
     * @param {number} outPort
     * @param {{x:number, y:number}} outTile
     * @returns {{id:number, inputs:number[], out:number}}
     */
    placeMachine(x, y, typeId, direction, inputPorts, outPort, outTile) {
        const handle = this.addMachine({inputs: inputPorts, out: outPort});
        const clientId = this.engine.allocateObjectId();
        handle.clientId = clientId;
        this._meta.set(handle.id, {clientId, typeId, x, y, direction, outPort, outTile});
        this._byClientId.set(clientId, handle.id);
        this.engine.registerRenderedPort(outPort, outTile.x, outTile.y);
        this.engine.emitEvent(new EasyObjectInsertEvent(typeId, clientId, x, y, direction, [BigInt(outPort)], null));
        return handle;
    }

    /**
     * The EasyObjectSyncEvents recreating this module's machines in `chunk`.
     * @param {number} chunk
     * @returns {EasyObjectSyncEvent[]}
     */
    chunkSync(chunk) {
        const events = [];
        this._meta.forEach((meta, eid) => {
            if (chunkId(meta.x, meta.y) === chunk) {
                const last = this.Machine.lastOutput[eid];
                events.push(new EasyObjectSyncEvent(
                    meta.typeId, meta.clientId, meta.x, meta.y, meta.direction,
                    [BigInt(meta.outPort)], last === EMPTY ? null : last,
                ));
            }
        });
        return events;
    }

    /**
     * Removes the machine with client id `clientId`, if any.
     * @param {BigInt} clientId
     * @returns {boolean}
     */
    removeMachineById(clientId) {
        const eid = this._byClientId.get(clientId);
        if (eid === undefined) {
            return false;
        }
        const meta = this._meta.get(eid);
        this.ids = this.ids.filter(id => id !== eid);
        this._meta.delete(eid);
        this._byClientId.delete(clientId);
        this.engine.unregisterRenderedPort(meta.outPort);
        this.engine.emitEvent(new EasyObjectDeleteEvent(meta.typeId, clientId, meta.x, meta.y));
        return true;
    }

    /**
     * The machine's current inspect snapshot, or null if no machine has that client id.
     * @param {BigInt} clientId
     * @returns {InspectHeartbeatEvent|null}
     */
    inspect(clientId) {
        const eid = this._byClientId.get(clientId);
        if (eid === undefined) {
            return null;
        }
        const P = this.engine.Port.item;
        const M = this.Machine;
        const inputPorts = [];
        const inputMemory = [];
        for (let i = 0; i < this.inputCount; i += 1) {
            const resting = P[M.in[i][eid]];
            inputPorts.push(resting === EMPTY ? 0 : resting);
            const slot = M.slot[i][eid];
            const batch = M.batch[i][eid];
            inputMemory.push(slot !== EMPTY ? slot : (batch !== EMPTY ? batch : 0));
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
            const slot = i < this.inputCount ? this.Machine.slot[i][eid] : EMPTY;
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
     * countdown reaches zero. Per-machine order matches the set-based SQL statement sequence
     * (machines never share ports).
     * @private
     * @returns {void}
     */
    _submitIntents() {
        const P = this.engine.Port.item;
        const M = this.Machine;
        this.ids.forEach(eid => {
            if (M.remaining[eid] > 0) {
                M.remaining[eid] -= 1;
            }

            // Gather while idle, or in step on the tick a free output lets the next batch load.
            const gathering = M.output[eid] === EMPTY || (M.remaining[eid] === 0 && P[M.out[eid]] === EMPTY);
            if (gathering) {
                for (let i = 0; i < this.inputCount; i += 1) {
                    const inPort = M.in[i][eid];
                    if (M.slot[i][eid] === EMPTY && P[inPort] !== EMPTY) {
                        this.engine.submitIntent({source: inPort, dest: EMPTY, managed: true});
                        M.slot[i][eid] = P[inPort];
                    }
                }
            }

            // Every port contributed: match the recipe, start the countdown, clear the slots.
            let allFilled = M.output[eid] === EMPTY;
            for (let i = 0; i < this.inputCount; i += 1) {
                if (M.slot[i][eid] === EMPTY) {
                    allFilled = false;
                }
            }
            if (allFilled) {
                M.output[eid] = this._resolveRecipe(eid);
                M.remaining[eid] = this.processingTicks;
                for (let i = 0; i < this.inputCount; i += 1) {
                    M.batch[i][eid] = M.slot[i][eid];
                    M.slot[i][eid] = EMPTY;
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
        this.ids.forEach(eid => {
            if (this.engine.wasResolvedDest(M.out[eid])) {
                M.lastOutput[eid] = M.output[eid];
                M.output[eid] = EMPTY;
                M.remaining[eid] = EMPTY;
                for (let i = 0; i < this.inputCount; i += 1) {
                    M.batch[i][eid] = EMPTY;
                }
            }
        });
    }
}
