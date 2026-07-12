import {test} from "node:test";
import assert from "node:assert/strict";
import BetterSqlite3 from "better-sqlite3";
import {Direction} from "@/common/constants.js";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";
import {BeltModule} from "@/mods/Logistics/BeltModule.js";

const RED = 1;
// A line straddling the y=64 chunk border -> two seam-connected paths.
const CELLS = [{x: 0, y: 62}, {x: 0, y: 63}, {x: 0, y: 64}, {x: 0, y: 65}];

// Network endpoints: the in-port that is no path's out-port, and the out-port that is no path's in-port.
function networkPorts(belts) {
    const ins = belts.paths.map(path => path.inPort);
    const outs = belts.paths.map(path => path.outPort);
    return {
        inPort: ins.find(port => !outs.includes(port)),
        outPort: outs.find(port => !ins.includes(port)),
    };
}

async function newModule() {
    const engine = new EcsEngine();
    await engine.init();
    return {engine, belts: new BeltModule(engine)};
}

test("belt state survives a snapshot -> serialize -> restore round-trip mid-flight", async () => {
    // Original: build the chunk-split line, feed an item, run a few ticks so it is mid-flight.
    const a = await newModule();
    CELLS.forEach(cell => a.belts.placeBelt(cell.x, cell.y, Direction.UP));
    const aPorts = networkPorts(a.belts);
    a.engine.setPortItem(aPorts.inPort, RED);
    for (let i = 0; i < 4; i += 1) {
        a.engine.setPortItem(aPorts.outPort, EMPTY);
        a.engine.tickAll();
    }

    // Snapshot through JSON (proves it is serializable), restore into a fresh engine.
    const serialized = JSON.stringify(a.belts.captureState());
    const b = await newModule();
    b.belts.restore(JSON.parse(serialized));

    // Structural check: same path count, item still in the system.
    assert.equal(b.belts.paths.length, a.belts.paths.length);

    // Both continue in lockstep; the restored engine must produce the same output stream.
    const bPorts = networkPorts(b.belts);
    const aStream = [];
    const bStream = [];
    for (let i = 0; i < 12; i += 1) {
        a.engine.setPortItem(aPorts.outPort, EMPTY);
        b.engine.setPortItem(bPorts.outPort, EMPTY);
        a.engine.tickAll();
        b.engine.tickAll();
        aStream.push(a.engine.portItem(aPorts.outPort));
        bStream.push(b.engine.portItem(bPorts.outPort));
    }

    assert.deepEqual(bStream, aStream, `\nrestored: ${JSON.stringify(bStream)}\noriginal: ${JSON.stringify(aStream)}`);
    assert.ok(aStream.includes(RED), "the in-flight item eventually pops out");
});

test("belt state persists through a real SQLite database and reloads", async () => {
    const a = await newModule();
    CELLS.forEach(cell => a.belts.placeBelt(cell.x, cell.y, Direction.UP));
    const ports = networkPorts(a.belts);
    a.engine.setPortItem(ports.inPort, RED);
    a.engine.tickAll();

    // Store the captured state in SQLite (the durable store), then reload it.
    const db = new BetterSqlite3(":memory:");
    db.exec("CREATE TABLE Save (id INTEGER PRIMARY KEY, state TEXT NOT NULL)");
    db.prepare("INSERT INTO Save (state) VALUES (?)").run(JSON.stringify(a.belts.captureState()));
    const loaded = JSON.parse(db.prepare("SELECT state FROM Save ORDER BY id DESC LIMIT 1").get().state);

    const b = await newModule();
    b.belts.restore(loaded);

    assert.equal(b.belts.paths.length, a.belts.paths.length);
    const bPorts = networkPorts(b.belts);
    let delivered = false;
    for (let i = 0; i < 12 && !delivered; i += 1) {
        b.engine.setPortItem(bPorts.outPort, EMPTY);
        b.engine.tickAll();
        delivered = b.engine.portItem(bPorts.outPort) === RED;
    }
    assert.ok(delivered, "the reloaded item flows to the output");
});
