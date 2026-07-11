import {addEntity, addComponent} from "bitecs";
import {TickPhase} from "@/common/core.js";
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
        };
        this._capacity = MACHINE_CAPACITY;
        this.ids = [];

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
            }
        });
    }
}
