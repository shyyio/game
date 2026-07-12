import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {DeleteObjectMessage} from "@/common/CoreMessages.js";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";
import {BeltModule} from "@/mods/Logistics/BeltModule.js";
import {SqlEngine} from "@/test/SqlEngine.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";

const RED = 1;
// A 5-belt line in one chunk; deleting the middle belt splits it into two paths.
const CELLS = [
    {x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4},
];
const DELETE = {x: 0, y: 2};
// The two surviving sub-runs, identified by a belt each: (0,4) heads the upstream part, (0,0) the downstream.
const UPSTREAM = {x: 0, y: 4};
const DOWNSTREAM = {x: 0, y: 0};

async function ecsAdapter() {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);
    CELLS.forEach(cell => belts.placeBelt(cell.x, cell.y, Direction.UP));
    belts.removeBelt(DELETE.x, DELETE.y, Direction.UP);
    return {
        pathCount: belts.paths.length,
        subPath: (tile) => belts.pathAt(tile.x, tile.y),
        setPortItem: (port, item) => engine.setPortItem(port, item),
        portItem: (port) => engine.portItem(port),
        tickAll: () => engine.tickAll(),
    };
}

async function sqlAdapter() {
    const engine = new SqlEngine([new LogisticsMod()]);
    await engine.init();
    CELLS.forEach(cell => engine.dispatchMessage(new CreateBeltMessage(cell.x, cell.y, Direction.UP, BELT_NORMAL)));
    const deleteId = Number(engine.rawScalar(`SELECT id FROM Belt WHERE x=${DELETE.x} AND y=${DELETE.y}`));
    engine.dispatchMessage(new DeleteObjectMessage(BigInt(deleteId)));
    return {
        pathCount: Number(engine.rawScalar("SELECT COUNT(*) FROM BeltPath")),
        subPath: (tile) => {
            const row = engine.rawAll(`
                SELECT bp.in_port_id AS inPort, bp.out_port_id AS outPort
                FROM BeltPath bp INNER JOIN Belt b ON b.path_id = bp.id
                WHERE b.x=${tile.x} AND b.y=${tile.y}
            `)[0];
            return {inPort: Number(row.inPort), outPort: Number(row.outPort)};
        },
        setPortItem: (port, item) => engine.setPortItem(port, item),
        portItem: (port) => {
            const item = engine.portItem(port);
            return item === null || item === undefined ? EMPTY : item;
        },
        tickAll: () => engine.tickAll(),
    };
}

// Feed a sub-path two items and drain its output; return the output stream.
function flow(adapter, tile) {
    const path = adapter.subPath(tile);
    const stream = [];
    for (let i = 0; i < 10; i += 1) {
        adapter.setPortItem(path.outPort, EMPTY);
        if (i < 2) {
            adapter.setPortItem(path.inPort, RED);
        }
        adapter.tickAll();
        stream.push(adapter.portItem(path.outPort));
    }
    return stream;
}

test("deleting a middle belt splits the path; both sides flow like SQL", async () => {
    const ecs = await ecsAdapter();
    const sql = await sqlAdapter();

    assert.equal(ecs.pathCount, 2, "ECS splits into two paths");
    assert.equal(sql.pathCount, 2, "SQL splits into two paths");

    assert.deepEqual(flow(ecs, UPSTREAM), flow(sql, UPSTREAM), "upstream sub-path output stream");
    assert.deepEqual(flow(ecs, DOWNSTREAM), flow(sql, DOWNSTREAM), "downstream sub-path output stream");
});
