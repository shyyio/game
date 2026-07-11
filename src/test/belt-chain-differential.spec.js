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
        addPath: (count, inPort) => belts.addPath(count, inPort),
        setPortItem: (port, item) => engine.setPortItem(port, item),
        snapshot: (handle) => belts.snapshot(handle.id),
        tickAll: () => engine.tickAll(),
    };
}

// ---- SQL adapter ----

async function sqlAdapter() {
    const engine = new SqlEngine([new LogisticsMod()]);
    await engine.init();
    let column = 0;
    return {
        addPath: (count, inPort) => {
            let resolvedInPort = inPort;
            if (resolvedInPort === undefined) {
                resolvedInPort = engine.rawScalar("INSERT INTO Port DEFAULT VALUES RETURNING id");
            }
            engine.rawExec(`UPDATE Port SET is_input_port=1 WHERE id=${resolvedInPort}`);
            const outPort = engine.rawScalar("INSERT INTO Port DEFAULT VALUES RETURNING id");
            const x = column;
            column += 1;
            const beltIds = [];
            for (let i = 0; i < count; i += 1) {
                beltIds.push(engine.rawScalar(`INSERT INTO Belt (x, y, type, direction) VALUES (${x}, ${i}, ${BELT_NORMAL}, ${Direction.UP}) RETURNING id`));
            }
            const head = beltIds[count - 1];
            const tail = beltIds[0];
            const length = count * 2 - 1;
            engine.rawExec(`
                INSERT INTO BeltPath (id, tail_id, length, head_gap, in_port_id, out_port_id)
                VALUES (${head}, ${tail}, ${length}, ${length}, ${resolvedInPort}, ${outPort})
            `);
            beltIds.forEach((id, index) => {
                engine.rawExec(`UPDATE Belt SET path_id=${head}, path_index=${index} WHERE id=${id}`);
            });
            return {id: head, inPort: resolvedInPort, outPort, length};
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

// A two-path chain sharing a seam port (A.out == B.in). The combined snapshot (both paths) must
// match across engines every step; A.out is the seam, so it also carries B's input state.
const scenarios = [
    {
        name: "a single item traverses both paths across the seam",
        steps: [{inject: RED, drainOut: true}, ...Array.from({length: 15}, () => ({drainOut: true}))],
    },
    {
        name: "a continuous feed pipelines the whole chain at full throughput",
        steps: Array.from({length: 16}, () => ({inject: RED, drainOut: true})),
    },
    {
        name: "a blocked output backs pressure up the whole chain",
        steps: Array.from({length: 16}, () => ({inject: RED})),
    },
];

/**
 * Runs a chain scenario against one engine, returning the combined snapshot trace of both paths.
 * @param {Function} makeAdapter
 * @param {object} scenario
 * @returns {Promise<object[]>}
 */
async function trace(makeAdapter, scenario) {
    const adapter = await makeAdapter();
    const a = adapter.addPath(BELT_COUNT);
    const b = adapter.addPath(BELT_COUNT, a.outPort);
    const result = [];
    scenario.steps.forEach(step => {
        if (step.drainOut) {
            adapter.setPortItem(b.outPort, EMPTY);
        }
        if (step.inject !== undefined) {
            adapter.setPortItem(a.inPort, step.inject);
        }
        adapter.tickAll();
        result.push({a: adapter.snapshot(a), b: adapter.snapshot(b)});
    });
    return result;
}

scenarios.forEach(scenario => {
    test(`differential belt chain: ${scenario.name}`, async () => {
        const ecs = await trace(ecsAdapter, scenario);
        const sql = await trace(sqlAdapter, scenario);
        assert.deepEqual(ecs, sql, `\nEcs: ${JSON.stringify(ecs)}\nSql: ${JSON.stringify(sql)}`);
    });
});
