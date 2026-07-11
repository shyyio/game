import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";
import {BeltModule} from "@/common/sim/BeltSystems.js";
import {SqlEngine} from "@/test/SqlEngine.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";

const RED = 1;

// ---- ECS adapter: build a path with placeBelt ----

async function ecsAdapter() {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);
    return {
        buildLine: (cells) => {
            let handle = null;
            cells.forEach(cell => {
                handle = belts.placeBelt(cell.x, cell.y, cell.direction);
            });
            return handle;
        },
        setPortItem: (port, item) => engine.setPortItem(port, item),
        snapshot: (handle) => belts.snapshot(handle.id),
        tickAll: () => engine.tickAll(),
    };
}

// ---- SQL adapter: build a path with createBelt (placement machinery) ----

async function sqlAdapter() {
    const engine = new SqlEngine([new LogisticsMod()]);
    await engine.init();
    return {
        buildLine: (cells) => {
            cells.forEach(cell => {
                engine.dispatchMessage(new CreateBeltMessage(cell.x, cell.y, cell.direction, BELT_NORMAL));
            });
            const path = engine.rawAll("SELECT id, in_port_id, out_port_id FROM BeltPath")[0];
            engine.rawExec(`UPDATE Port SET is_input_port=1 WHERE id=${path.in_port_id}`);
            return {id: Number(path.id), inPort: Number(path.in_port_id), outPort: Number(path.out_port_id)};
        },
        setPortItem: (port, item) => engine.setPortItem(port, item),
        snapshot: (handle) => ({
            items: engine.rawAll(`SELECT length, type FROM BeltPathItem WHERE path_id=${handle.id} ORDER BY id`)
                .map(row => ({length: Number(row.length), type: Number(row.type)})),
            headGap: engine.rawScalar(`SELECT head_gap FROM BeltPath WHERE id=${handle.id}`),
            out: (() => {
                const item = engine.rawScalar(`SELECT item FROM Port WHERE id=${handle.outPort}`);
                return item === null || item === undefined ? EMPTY : item;
            })(),
        }),
        tickAll: () => engine.tickAll(),
    };
}

// A straight line of three same-direction belts, built one belt at a time, then fed an item.
function line(direction, cells) {
    return {
        direction,
        cells,
        steps: [{inject: RED}, ...Array.from({length: 8}, () => ({drainOut: true}))],
    };
}

const scenarios = [
    {name: "an upward line built belt-by-belt", ...line(Direction.UP, [
        {x: 0, y: 0, direction: Direction.UP},
        {x: 0, y: 1, direction: Direction.UP},
        {x: 0, y: 2, direction: Direction.UP},
    ])},
    {name: "a rightward line built belt-by-belt", ...line(Direction.RIGHT, [
        {x: 0, y: 0, direction: Direction.RIGHT},
        {x: 1, y: 0, direction: Direction.RIGHT},
        {x: 2, y: 0, direction: Direction.RIGHT},
    ])},
];

async function trace(makeAdapter, scenario) {
    const adapter = await makeAdapter();
    const handle = adapter.buildLine(scenario.cells);
    const result = [];
    scenario.steps.forEach(step => {
        if (step.drainOut) {
            adapter.setPortItem(handle.outPort, EMPTY);
        }
        if (step.inject !== undefined) {
            adapter.setPortItem(handle.inPort, step.inject);
        }
        adapter.tickAll();
        result.push(adapter.snapshot(handle));
    });
    return result;
}

scenarios.forEach(scenario => {
    test(`belt topology: ${scenario.name}`, async () => {
        const ecs = await trace(ecsAdapter, scenario);
        const sql = await trace(sqlAdapter, scenario);
        assert.deepEqual(ecs, sql, `\nEcs: ${JSON.stringify(ecs)}\nSql: ${JSON.stringify(sql)}`);
    });
});
