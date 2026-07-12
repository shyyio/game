import {test} from "node:test";
import assert from "node:assert/strict";
import {AbstractMod, ObjectDefinition, PortDefinition, RecipeDefinition} from "@/common/core.js";
import {EasyRecipeProcessor} from "@/common/EasyRecipeProcessor.js";
import {EasyObjectPlacement} from "@/common/EasyObjectPlacement.js";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";
import {BeltModule} from "@/mods/Logistics/BeltModule.js";
import {MachineModule} from "@/common/sim/MachineSystems.js";
import {SqlEngine} from "@/test/SqlEngine.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";

const COAL = 5;
const COKE = 12;
const COOK_SLAG = 99;
const COOK_VERB = 2;
const PROCESSING_TICKS = 1;
const BELT_COUNT = 2;

const RECIPES = [{inputs: [COAL], output: COKE}];

// ---- ECS adapter: a belt path feeding a one-input furnace ----

async function ecsAdapter() {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);
    const machines = new MachineModule(engine, {
        processingTicks: PROCESSING_TICKS,
        inputCount: 1,
        recipes: RECIPES,
        fallback: COOK_SLAG,
    });
    const belt = belts.addPath(BELT_COUNT);
    const furnace = machines.addMachine({inputs: [belt.outPort]});
    return {
        beltIn: belt.inPort,
        furnaceOut: furnace.out,
        setPortItem: (port, item) => engine.setPortItem(port, item),
        portItem: (port) => engine.portItem(port),
        beltSnapshot: () => belts.snapshot(belt.id),
        tickAll: () => engine.tickAll(),
    };
}

// ---- SQL adapter ----

function furnaceDefinition() {
    const definition = new ObjectDefinition({
        table: "Furnace",
        inputPorts: [new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP})],
        outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
        internalPorts: [],
        geometry: "1x1",
    });
    new EasyRecipeProcessor({verb: COOK_VERB, processingTicks: PROCESSING_TICKS}).install(definition);
    return definition;
}

class FurnaceMod extends AbstractMod {

    constructor() {
        super();
        this._definition = furnaceDefinition();
        this._placement = new EasyObjectPlacement(this._definition);
    }

    get schema() {
        return this._placement.schema;
    }

    get definitions() {
        return {Furnace: this._definition};
    }

    get recipes() {
        return RECIPES.map(recipe => new RecipeDefinition(COOK_VERB, recipe.inputs, recipe.output));
    }

    get verbFallbacks() {
        return [{verb: COOK_VERB, output: COOK_SLAG}];
    }

    get extraStatements() {
        return this._placement.statements;
    }
}

async function sqlAdapter() {
    const engine = new SqlEngine([new LogisticsMod(), new FurnaceMod()]);
    await engine.init();

    const beltIn = engine.rawScalar("INSERT INTO Port DEFAULT VALUES RETURNING id");
    engine.rawExec(`UPDATE Port SET is_input_port=1 WHERE id=${beltIn}`);
    const seam = engine.rawScalar("INSERT INTO Port DEFAULT VALUES RETURNING id");
    const beltIds = [];
    for (let i = 0; i < BELT_COUNT; i += 1) {
        beltIds.push(engine.rawScalar(`INSERT INTO Belt (x, y, type, direction) VALUES (0, ${i}, ${BELT_NORMAL}, ${Direction.UP}) RETURNING id`));
    }
    const head = beltIds[BELT_COUNT - 1];
    const tail = beltIds[0];
    const length = BELT_COUNT * 2 - 1;
    engine.rawExec(`INSERT INTO BeltPath (id, tail_id, length, head_gap, in_port_id, out_port_id) VALUES (${head}, ${tail}, ${length}, ${length}, ${beltIn}, ${seam})`);
    beltIds.forEach((id, index) => {
        engine.rawExec(`UPDATE Belt SET path_id=${head}, path_index=${index} WHERE id=${id}`);
    });

    const furnaceOut = engine.rawScalar("INSERT INTO Port DEFAULT VALUES RETURNING id");
    engine.rawExec(`INSERT INTO Furnace (x, y, direction, in_id, out_id) VALUES (0, 10, ${Direction.UP}, ${seam}, ${furnaceOut})`);

    return {
        beltIn,
        furnaceOut,
        setPortItem: (port, item) => engine.setPortItem(port, item),
        portItem: (port) => engine.portItem(port),
        beltSnapshot: () => ({
            items: engine.rawAll(`SELECT length, type FROM BeltPathItem WHERE path_id=${head} ORDER BY id`)
                .map(row => ({length: Number(row.length), type: Number(row.type)})),
            headGap: engine.rawScalar(`SELECT head_gap FROM BeltPath WHERE id=${head}`),
            out: (() => {
                const item = engine.rawScalar(`SELECT item FROM Port WHERE id=${seam}`);
                return item === null || item === undefined ? EMPTY : item;
            })(),
        }),
        tickAll: () => engine.tickAll(),
    };
}

const scenarios = [
    {
        name: "one coal travels the belt, is cooked, and coke appears at the furnace output",
        steps: [{inject: COAL, drain: true}, ...Array.from({length: 9}, () => ({drain: true}))],
    },
    {
        name: "a continuously fed belt keeps the furnace producing",
        steps: Array.from({length: 12}, () => ({inject: COAL, drain: true})),
    },
];

async function trace(makeAdapter, scenario) {
    const adapter = await makeAdapter();
    const result = [];
    scenario.steps.forEach(step => {
        if (step.drain) {
            adapter.setPortItem(adapter.furnaceOut, EMPTY);
        }
        if (step.inject !== undefined) {
            adapter.setPortItem(adapter.beltIn, step.inject);
        }
        adapter.tickAll();
        result.push({belt: adapter.beltSnapshot(), furnaceOut: adapter.portItem(adapter.furnaceOut)});
    });
    return result;
}

scenarios.forEach(scenario => {
    test(`belt->machine composition: ${scenario.name}`, async () => {
        const ecs = await trace(ecsAdapter, scenario);
        const sql = await trace(sqlAdapter, scenario);
        assert.deepEqual(ecs, sql, `\nEcs: ${JSON.stringify(ecs)}\nSql: ${JSON.stringify(sql)}`);
    });
});
