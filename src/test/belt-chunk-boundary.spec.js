import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";
import {BeltModule} from "@/mods/Logistics/BeltModule.js";
import {SqlEngine} from "@/test/SqlEngine.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";

const RED = 1;

// A vertical line straddling the y=64 chunk border: y=62,63 in one chunk, y=64,65 in the next.
const CELLS = [
    {x: 0, y: 62}, {x: 0, y: 63}, {x: 0, y: 64}, {x: 0, y: 65},
];

async function ecsAdapter() {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);
    let handle = null;
    CELLS.forEach(cell => {
        handle = belts.placeBelt(cell.x, cell.y, Direction.UP);
    });
    return {
        pathCount: handle.segments.length,
        inPort: handle.inPort,
        outPort: handle.outPort,
        setPortItem: (port, item) => engine.setPortItem(port, item),
        portItem: (port) => engine.portItem(port),
        tickAll: () => engine.tickAll(),
    };
}

async function sqlAdapter() {
    const engine = new SqlEngine([new LogisticsMod()]);
    await engine.init();
    CELLS.forEach(cell => {
        engine.dispatchMessage(new CreateBeltMessage(cell.x, cell.y, Direction.UP, BELT_NORMAL));
    });
    const inPort = Number(engine.rawScalar("SELECT in_port_id FROM BeltPath WHERE in_port_id NOT IN (SELECT out_port_id FROM BeltPath)"));
    const outPort = Number(engine.rawScalar("SELECT out_port_id FROM BeltPath WHERE out_port_id NOT IN (SELECT in_port_id FROM BeltPath)"));
    return {
        pathCount: Number(engine.rawScalar("SELECT COUNT(*) FROM BeltPath")),
        inPort,
        outPort,
        setPortItem: (port, item) => engine.setPortItem(port, item),
        portItem: (port) => {
            const item = engine.portItem(port);
            return item === null || item === undefined ? EMPTY : item;
        },
        tickAll: () => engine.tickAll(),
    };
}

// Feed a few items in, drain the network output each tick, and record the output stream (what sits in
// the final out-port each tick). Observable parity: the stream must match, and the line must split
// into the same number of per-chunk paths.
async function run(makeAdapter) {
    const adapter = await makeAdapter();
    const outStream = [];
    for (let i = 0; i < 24; i += 1) {
        adapter.setPortItem(adapter.outPort, EMPTY);
        if (i < 3) {
            adapter.setPortItem(adapter.inPort, RED);
        }
        adapter.tickAll();
        outStream.push(adapter.portItem(adapter.outPort));
    }
    return {pathCount: adapter.pathCount, outStream};
}

test("a belt line splits at the chunk boundary and items flow across identically", async () => {
    const ecs = await run(ecsAdapter);
    const sql = await run(sqlAdapter);

    // Hard constraint: the line is two per-chunk paths, not one crossing the border.
    assert.equal(ecs.pathCount, 2, "ECS must split the line into two per-chunk paths");
    assert.equal(sql.pathCount, 2, "SQL splits the line into two per-chunk paths");

    // Observable parity: identical output stream, and every fed item delivered.
    assert.deepEqual(ecs.outStream, sql.outStream, `\nEcs: ${JSON.stringify(ecs.outStream)}\nSql: ${JSON.stringify(sql.outStream)}`);
    assert.equal(ecs.outStream.filter(item => item === RED).length, 3, "all three items delivered");
});
