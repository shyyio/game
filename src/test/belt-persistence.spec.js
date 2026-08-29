import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {EMPTY} from "@/sim/sentinels.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {BeltDefinition} from "@/mods/Logistics/common/objectTypes.js";
import {beltsOf} from "@/mods/Logistics/sim/testHelpers.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";

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
    const engine = await makeGameEngine();
    return {engine, belts: beltsOf(engine)};
}

test("belt state survives a serialize -> deserialize round-trip mid-flight", async () => {
    // Original: build the chunk-split line, feed an item, run a few ticks so it is mid-flight.
    const a = await newModule();
    for (const cell of CELLS) {
        a.engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, cell.x, cell.y, Direction.UP));
    }
    const aPorts = networkPorts(a.belts);
    a.engine.ports.setItem(aPorts.inPort, RED);
    for (let i = 0; i < 4; i += 1) {
        a.engine.ports.setItem(aPorts.outPort, EMPTY);
        a.engine.tickAll();
    }

    // Snapshot through JSON (proves it is serializable), restore into a fresh engine.
    const serialized = JSON.parse(JSON.stringify(a.engine.serialize()));
    const b = await newModule();
    b.engine.deserialize(serialized);

    // Structural check: same path count, item still in the system.
    assert.equal(b.belts.paths.length, a.belts.paths.length);

    // Both continue in lockstep; the restored engine must produce the same output stream.
    const bPorts = networkPorts(b.belts);
    const aStream = [];
    const bStream = [];
    for (let i = 0; i < 12; i += 1) {
        a.engine.ports.setItem(aPorts.outPort, EMPTY);
        b.engine.ports.setItem(bPorts.outPort, EMPTY);
        a.engine.tickAll();
        b.engine.tickAll();
        aStream.push(a.engine.ports.item(aPorts.outPort));
        bStream.push(b.engine.ports.item(bPorts.outPort));
    }

    assert.deepEqual(bStream, aStream, `\nrestored: ${JSON.stringify(bStream)}\noriginal: ${JSON.stringify(aStream)}`);
    assert.ok(aStream.includes(RED), "the in-flight item eventually pops out");
});

test("belt state persists through a structured SQLite save store and reloads", async () => {
    const a = await newModule();
    for (const cell of CELLS) {
        a.engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, cell.x, cell.y, Direction.UP));
    }
    const ports = networkPorts(a.belts);
    a.engine.ports.setItem(ports.inPort, RED);
    a.engine.tickAll();

    const store = new NodeSaveStore(":memory:");
    await store.save(a.engine.serialize());
    const loaded = await store.load();

    const b = await newModule();
    b.engine.deserialize(loaded);

    assert.equal(b.belts.paths.length, a.belts.paths.length);
    const bPorts = networkPorts(b.belts);
    let delivered = false;
    for (let i = 0; i < 12 && !delivered; i += 1) {
        b.engine.ports.setItem(bPorts.outPort, EMPTY);
        b.engine.tickAll();
        delivered = b.engine.ports.item(bPorts.outPort) === RED;
    }
    assert.ok(delivered, "the reloaded item flows to the output");
});
