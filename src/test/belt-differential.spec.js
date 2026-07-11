import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";
import {BeltModule} from "@/common/sim/BeltSystems.js";
import {SqlEngine} from "@/test/SqlEngine.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";

const RED = 1;
const BELT_COUNT = 3;

// ---- ECS adapter ----

async function ecsAdapter() {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);
    return {
        addPath: (count) => belts.addPath(count),
        setPortItem: (port, item) => engine.setPortItem(port, item),
        snapshot: (handle) => belts.snapshot(handle.id),
        tickAll: () => engine.tickAll(),
    };
}

// ---- SQL adapter ----

async function sqlAdapter() {
    const engine = new SqlEngine([new LogisticsMod()]);
    await engine.init();
    return {
        addPath: (count) => {
            const inPort = engine.rawScalar("INSERT INTO Port DEFAULT VALUES RETURNING id");
            engine.rawExec(`UPDATE Port SET is_input_port=1 WHERE id=${inPort}`);
            const outPort = engine.rawScalar("INSERT INTO Port DEFAULT VALUES RETURNING id");
            const beltIds = [];
            for (let i = 0; i < count; i += 1) {
                beltIds.push(engine.rawScalar(`INSERT INTO Belt (x, y, type, direction) VALUES (0, ${i}, ${BELT_NORMAL}, ${Direction.UP}) RETURNING id`));
            }
            const head = beltIds[count - 1];
            const tail = beltIds[0];
            const length = count * 2 - 1;
            engine.rawExec(`
                INSERT INTO BeltPath (id, tail_id, length, head_gap, in_port_id, out_port_id)
                VALUES (${head}, ${tail}, ${length}, ${length}, ${inPort}, ${outPort})
            `);
            beltIds.forEach((id, index) => {
                engine.rawExec(`UPDATE Belt SET path_id=${head}, path_index=${index} WHERE id=${id}`);
            });
            return {id: head, inPort, outPort, length};
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

// Each scenario feeds/drains the path's ports per step, ticks, then records the snapshot; the trace
// (RLE runs + head_gap + out-port item) must match across engines every step.
const scenarios = [
    {
        name: "a single item traverses the path and pops",
        steps: [
            {inject: RED},
            {drainOut: true}, {drainOut: true}, {drainOut: true},
            {drainOut: true}, {drainOut: true}, {drainOut: true}, {drainOut: true},
        ],
    },
    {
        name: "a continuously fed path with a draining output flows steadily",
        steps: Array.from({length: 10}, () => ({inject: RED, drainOut: true})),
    },
    {
        name: "a continuously fed path backs up when the output is blocked",
        steps: Array.from({length: 10}, () => ({inject: RED})),
    },
    {
        name: "intermittent feeding leaves gaps between items",
        steps: [
            {inject: RED, drainOut: true},
            {drainOut: true},
            {inject: RED, drainOut: true},
            {drainOut: true},
            {inject: RED, drainOut: true},
            {drainOut: true}, {drainOut: true}, {drainOut: true}, {drainOut: true}, {drainOut: true},
        ],
    },
];

/**
 * Runs a scenario against one engine, returning the snapshot trace.
 * @param {Function} makeAdapter
 * @param {object} scenario
 * @returns {Promise<object[]>}
 */
async function trace(makeAdapter, scenario) {
    const adapter = await makeAdapter();
    const handle = adapter.addPath(BELT_COUNT);
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
    test(`differential belt: ${scenario.name}`, async () => {
        const ecs = await trace(ecsAdapter, scenario);
        const sql = await trace(sqlAdapter, scenario);
        assert.deepEqual(ecs, sql, `\nEcs: ${JSON.stringify(ecs)}\nSql: ${JSON.stringify(sql)}`);
    });
});
