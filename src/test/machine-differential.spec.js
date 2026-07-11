import {test} from "node:test";
import assert from "node:assert/strict";
import {AbstractMod, ObjectDefinition, PortDefinition, RecipeDefinition} from "@/common/core.js";
import {EasyRecipeProcessor} from "@/common/EasyRecipeProcessor.js";
import {EasyObjectPlacement} from "@/common/EasyObjectPlacement.js";
import {Direction} from "@/common/constants.js";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";
import {MachineModule} from "@/common/sim/MachineSystems.js";
import {SqlEngine} from "@/test/SqlEngine.js";

// Item types + verbs.
const RED = 1;
const GREEN = 2;
const BLUE = 4;
const ALLOY = 10;
const INVERSE_ALLOY = 13;
const MIX_JUNK = 98;
const COAL = 5;
const COKE = 12;
const COOK_SLAG = 99;

// Machine configs, shared by both engines.
const MIX = {
    table: "Mixer",
    verb: 1,
    processingTicks: 1,
    inputCount: 2,
    portColumns: ["a_id", "b_id", "out_id"],
    portVecs: [
        {x: 0, y: 0, direction: Direction.UP},
        {x: 0, y: 0, direction: Direction.RIGHT},
    ],
    recipes: [
        {inputs: [RED, GREEN], output: ALLOY},
        {inputs: [GREEN, RED], output: INVERSE_ALLOY},
    ],
    fallback: MIX_JUNK,
};
const COOK = {
    table: "Furnace",
    verb: 2,
    processingTicks: 3,
    inputCount: 1,
    portColumns: ["in_id", "out_id"],
    portVecs: [{x: 0, y: 0, direction: Direction.UP}],
    recipes: [{inputs: [COAL], output: COKE}],
    fallback: COOK_SLAG,
};

// ---- ECS adapter ----

async function ecsAdapter(config) {
    const engine = new EcsEngine();
    await engine.init();
    const machine = new MachineModule(engine, {
        processingTicks: config.processingTicks,
        inputCount: config.inputCount,
        recipes: config.recipes,
        fallback: config.fallback,
    });
    return {
        addMachine: () => machine.addMachine(),
        setPortItem: (port, item) => engine.setPortItem(port, item),
        portItem: (port) => engine.portItem(port),
        tickAll: () => engine.tickAll(),
    };
}

// ---- SQL adapter ----

function buildDefinition(config) {
    const definition = new ObjectDefinition({
        table: config.table,
        inputPorts: config.portVecs.map((vec, i) => new PortDefinition(config.portColumns[i].replace("_id", ""), vec)),
        outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
        internalPorts: [],
        geometry: "1x1",
    });
    new EasyRecipeProcessor({verb: config.verb, processingTicks: config.processingTicks}).install(definition);
    return definition;
}

// A minimal sim-side mod exposing one machine definition + its recipes.
class MachineMod extends AbstractMod {

    constructor(definition, config) {
        super();
        this._definition = definition;
        this._config = config;
        this._placement = new EasyObjectPlacement(definition);
    }

    get schema() {
        return this._placement.schema;
    }

    get definitions() {
        return {[this._definition.table]: this._definition};
    }

    get recipes() {
        return this._config.recipes.map(recipe => new RecipeDefinition(this._config.verb, recipe.inputs, recipe.output));
    }

    get verbFallbacks() {
        return [{verb: this._config.verb, output: this._config.fallback}];
    }

    get extraStatements() {
        return this._placement.statements;
    }
}

async function sqlAdapter(config) {
    const engine = new SqlEngine([new MachineMod(buildDefinition(config), config)]);
    await engine.init();
    return {
        addMachine: () => {
            const ports = config.portColumns.map(() => engine.rawScalar("INSERT INTO Port DEFAULT VALUES RETURNING id"));
            const columns = config.portColumns.join(", ");
            const values = ports.join(", ");
            const id = engine.rawScalar(`
                INSERT INTO ${config.table} (x, y, direction, ${columns})
                VALUES (0, 0, ${Direction.UP}, ${values})
                RETURNING id
            `);
            return {id, inputs: ports.slice(0, config.inputCount), out: ports[ports.length - 1]};
        },
        setPortItem: (port, item) => engine.setPortItem(port, item),
        portItem: (port) => engine.portItem(port),
        tickAll: () => engine.tickAll(),
    };
}

// The observable machine state: its input port items and its output port item.
function snapshot(adapter, m) {
    return {
        inputs: m.inputs.map(port => adapter.portItem(port)),
        out: adapter.portItem(m.out),
    };
}

/**
 * Runs a scenario against one engine, returning the post-step snapshot trace.
 * @param {Function} makeAdapter
 * @param {object} config
 * @param {object} scenario
 * @returns {Promise<object[]>}
 */
async function trace(makeAdapter, config, scenario) {
    const adapter = await makeAdapter(config);
    const m = adapter.addMachine();
    const result = [];
    scenario.steps.forEach(step => {
        if (step.drainOut) {
            adapter.setPortItem(m.out, EMPTY);
        }
        Object.entries(step.inject || {}).forEach(([index, type]) => {
            adapter.setPortItem(m.inputs[Number(index)], type);
        });
        adapter.tickAll();
        result.push(snapshot(adapter, m));
    });
    return result;
}

const scenarios = [
    {config: MIX, name: "mixes two inputs into the recipe output", steps: [{inject: {0: RED, 1: GREEN}}, {}]},
    {config: MIX, name: "matches inputs by port order", steps: [{inject: {0: GREEN, 1: RED}}, {}]},
    {config: MIX, name: "falls back when no recipe matches", steps: [{inject: {0: RED, 1: BLUE}}, {}]},
    {config: MIX, name: "gathers inputs arriving on different ticks", steps: [{inject: {0: RED}}, {inject: {1: GREEN}}, {}]},
    {
        config: MIX,
        name: "pipelines the next batch on the tick it produces",
        steps: Array.from({length: 12}, () => ({inject: {0: RED, 1: GREEN}, drainOut: true})),
    },
    {
        config: COOK,
        name: "furnace takes its full processing time to cook",
        steps: [{inject: {0: COAL}}, {}, {}, {}, {}],
    },
];

scenarios.forEach(scenario => {
    test(`differential machine: ${scenario.name}`, async () => {
        const ecs = await trace(ecsAdapter, scenario.config, scenario);
        const sql = await trace(sqlAdapter, scenario.config, scenario);
        assert.deepEqual(ecs, sql, `\nEcs: ${JSON.stringify(ecs)}\nSql: ${JSON.stringify(sql)}`);
    });
});
