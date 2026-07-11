import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";
import {BeltModule} from "@/common/sim/BeltSystems.js";
import {SplitterModule} from "@/common/sim/SplitterSystems.js";
import {SqlEngine} from "@/test/SqlEngine.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";

const RED = 1;
const BELT_COUNT = 2;

// ---- ECS adapter: a belt path feeding splitter in_a ----

async function ecsAdapter() {
    const engine = new EcsEngine();
    await engine.init();
    // Splitter constructed before the belt so its POST_RESOLVE seam reads the shared in-port before
    // the belt writes this tick's pop into it (matches the SQL SplitterRecordStage1 / FillOutPort order).
    const splitter = new SplitterModule(engine);
    const belts = new BeltModule(engine);
    const belt = belts.addPath(BELT_COUNT);
    const s = splitter.addSplitter({in_a: belt.outPort});
    return {
        beltIn: belt.inPort,
        outA: s.out_a,
        outB: s.out_b,
        setPortItem: (port, item) => engine.setPortItem(port, item),
        portItem: (port) => engine.portItem(port),
        beltSnapshot: () => belts.snapshot(belt.id),
        tickAll: () => engine.tickAll(),
    };
}

// ---- SQL adapter ----

async function sqlAdapter() {
    const engine = new SqlEngine([new LogisticsMod()]);
    await engine.init();
    const port = () => engine.rawScalar("INSERT INTO Port DEFAULT VALUES RETURNING id");

    const beltIn = port();
    engine.rawExec(`UPDATE Port SET is_input_port=1 WHERE id=${beltIn}`);
    const seam = port();
    const beltIds = [];
    for (let i = 0; i < BELT_COUNT; i += 1) {
        beltIds.push(engine.rawScalar(`INSERT INTO Belt (x, y, type, direction) VALUES (0, ${i}, ${BELT_NORMAL}, ${Direction.UP}) RETURNING id`));
    }
    const head = beltIds[BELT_COUNT - 1];
    const length = BELT_COUNT * 2 - 1;
    engine.rawExec(`INSERT INTO BeltPath (id, tail_id, length, head_gap, in_port_id, out_port_id) VALUES (${head}, ${beltIds[0]}, ${length}, ${length}, ${beltIn}, ${seam})`);
    beltIds.forEach((id, index) => {
        engine.rawExec(`UPDATE Belt SET path_id=${head}, path_index=${index} WHERE id=${id}`);
    });

    const inB = port();
    const outA = port();
    const outB = port();
    const intA = port();
    const intB = port();
    engine.rawExec(`INSERT INTO Splitter (x, y, direction, in_a_id, in_b_id, out_a_id, out_b_id, int_a_id, int_b_id, state) VALUES (0, 10, ${Direction.UP}, ${seam}, ${inB}, ${outA}, ${outB}, ${intA}, ${intB}, 0)`);

    return {
        beltIn,
        outA,
        outB,
        setPortItem: (p, item) => engine.setPortItem(p, item),
        portItem: (p) => engine.portItem(p),
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

const scenario = {
    // Feed the belt for a few ticks, drain both splitter outputs every tick.
    steps: Array.from({length: 14}, (unused, i) => ({inject: i < 4, drain: true})),
};

async function trace(makeAdapter) {
    const adapter = await makeAdapter();
    const result = [];
    scenario.steps.forEach(step => {
        if (step.drain) {
            adapter.setPortItem(adapter.outA, EMPTY);
            adapter.setPortItem(adapter.outB, EMPTY);
        }
        if (step.inject) {
            adapter.setPortItem(adapter.beltIn, RED);
        }
        adapter.tickAll();
        result.push({
            belt: adapter.beltSnapshot(),
            outA: adapter.portItem(adapter.outA),
            outB: adapter.portItem(adapter.outB),
        });
    });
    return result;
}

test("belt->splitter composition matches SQL", async () => {
    const ecs = await trace(ecsAdapter);
    const sql = await trace(sqlAdapter);
    assert.deepEqual(ecs, sql, `\nEcs: ${JSON.stringify(ecs)}\nSql: ${JSON.stringify(sql)}`);
});
