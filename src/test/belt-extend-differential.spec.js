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

async function ecsAdapter() {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);
    let handle = null;
    return {
        place: (x, y, direction) => {
            handle = belts.placeBelt(x, y, direction);
        },
        inject: (type) => engine.setPortItem(handle.inPort, type),
        tick: (drain) => {
            if (drain) {
                engine.setPortItem(handle.outPort, EMPTY);
            }
            engine.tickAll();
        },
        snapshot: () => belts.snapshot(handle.id),
    };
}

async function sqlAdapter() {
    const engine = new SqlEngine([new LogisticsMod()]);
    await engine.init();
    let handle = null;
    const refresh = () => {
        const path = engine.rawAll("SELECT id, in_port_id, out_port_id FROM BeltPath")[0];
        handle = {id: Number(path.id), inPort: Number(path.in_port_id), outPort: Number(path.out_port_id)};
    };
    return {
        place: (x, y, direction) => {
            engine.dispatchMessage(new CreateBeltMessage(x, y, direction, BELT_NORMAL));
            refresh();
        },
        inject: (type) => engine.setPortItem(handle.inPort, type),
        tick: (drain) => {
            if (drain) {
                engine.setPortItem(handle.outPort, EMPTY);
            }
            engine.tickAll();
            refresh();
        },
        snapshot: () => ({
            items: engine.rawAll(`SELECT length, type FROM BeltPathItem WHERE path_id=${handle.id} ORDER BY id`)
                .map(row => ({length: Number(row.length), type: Number(row.type)})),
            headGap: engine.rawScalar(`SELECT head_gap FROM BeltPath WHERE id=${handle.id}`),
            out: (() => {
                const item = engine.rawScalar(`SELECT item FROM Port WHERE id=${handle.outPort}`);
                return item === null || item === undefined ? EMPTY : item;
            })(),
        }),
    };
}

// Ops: build a path, inject an item, run a couple ticks so it's in flight, extend the path at one
// end mid-flight, then keep ticking. Snapshots after each place/tick must match across engines.
const scenarios = [
    {
        name: "head extension while an item is in flight",
        ops: [
            {place: [0, 0, Direction.UP]},
            {place: [0, 1, Direction.UP]},
            {place: [0, 2, Direction.UP]},
            {inject: RED},
            {tick: true}, {tick: true},
            {place: [0, 3, Direction.UP]},
            {tick: true}, {tick: true}, {tick: true}, {tick: true}, {tick: true}, {tick: true}, {tick: true},
        ],
    },
    {
        name: "repeated head extensions while an item is in flight",
        ops: [
            {place: [0, 0, Direction.UP]},
            {place: [0, 1, Direction.UP]},
            {inject: RED},
            {tick: true}, {tick: true},
            {place: [0, 2, Direction.UP]},
            {tick: true}, {tick: true},
            {place: [0, 3, Direction.UP]},
            {tick: true}, {tick: true}, {tick: true}, {tick: true}, {tick: true}, {tick: true},
        ],
    },
];

async function trace(makeAdapter, scenario) {
    const adapter = await makeAdapter();
    const result = [];
    scenario.ops.forEach(op => {
        if (op.place !== undefined) {
            adapter.place(op.place[0], op.place[1], op.place[2]);
            result.push(adapter.snapshot());
        } else if (op.inject !== undefined) {
            adapter.inject(op.inject);
        } else {
            adapter.tick(op.tick);
            result.push(adapter.snapshot());
        }
    });
    return result;
}

scenarios.forEach(scenario => {
    test(`belt extend: ${scenario.name}`, async () => {
        const ecs = await trace(ecsAdapter, scenario);
        const sql = await trace(sqlAdapter, scenario);
        assert.deepEqual(ecs, sql, `\nEcs: ${JSON.stringify(ecs)}\nSql: ${JSON.stringify(sql)}`);
    });
});
