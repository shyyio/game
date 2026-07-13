import {test} from "node:test";
import assert from "node:assert/strict";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";

// Boots an engine with `count` ports; the eids in `filledIds` (1-based, matching creation order)
// carry item type 1.
async function setup(count, filledIds) {
    const engine = new EcsEngine();
    await engine.init();
    const ports = [];
    for (let i = 0; i < count; i += 1) {
        ports.push(engine.createPort(filledIds.includes(i + 1) ? 1 : EMPTY));
    }
    return {engine, ports};
}

// Runs the resolve + commit phases so a move (or sink) lands in Port.
function settle(engine) {
    engine.resolvePortTransfer();
    engine.flushSinks();
    engine.commitTransfers();
}

test("Resolves a packed transfer chain as a single shift when the end drains", async () => {
    const {engine, ports} = await setup(4, [1, 2, 3]);
    engine.submitIntent({source: ports[0], dest: ports[1], destEmpty: false});
    engine.submitIntent({source: ports[1], dest: ports[2], destEmpty: false});
    engine.submitIntent({source: ports[2], dest: ports[3], destEmpty: true});

    engine.resolvePortTransfer();

    assert.equal(engine.resolvedEdges(), `${ports[0]}->${ports[1]}, ${ports[1]}->${ports[2]}, ${ports[2]}->${ports[3]}`);
});

test("Resolves no transfer when the chain's end is blocked", async () => {
    const {engine, ports} = await setup(4, [1, 2, 3, 4]);
    engine.submitIntent({source: ports[0], dest: ports[1], destEmpty: false});
    engine.submitIntent({source: ports[1], dest: ports[2], destEmpty: false});
    engine.submitIntent({source: ports[2], dest: ports[3], destEmpty: false});

    engine.resolvePortTransfer();

    assert.equal(engine.resolvedEdges(), "");
});

test("Translates the item type on a managed transfer via output_item", async () => {
    const {engine, ports} = await setup(2, [1]);
    engine.submitIntent({source: ports[0], dest: ports[1], destEmpty: true, managed: true, outputItem: 99});

    settle(engine);

    assert.equal(engine.portItem(ports[0]), EMPTY);
    assert.equal(engine.portItem(ports[1]), 99);
});

test("Creates a brand-new item with a source-less managed intent", async () => {
    const {engine, ports} = await setup(1, []);
    engine.submitIntent({source: EMPTY, dest: ports[0], destEmpty: true, outputItem: 55, managed: true});

    settle(engine);

    assert.equal(engine.portItem(ports[0]), 55);
});

test("Sinks (consumes) the source item on a managed destination-less intent", async () => {
    const {engine, ports} = await setup(1, [1]);
    engine.submitIntent({source: ports[0], dest: EMPTY, managed: true});

    settle(engine);

    assert.equal(engine.portItem(ports[0]), EMPTY);
});

test("Leaves an unmanaged destination-less intent (self-drain) untouched", async () => {
    const {engine, ports} = await setup(1, [1]);
    engine.submitIntent({source: ports[0], dest: EMPTY, managed: false});

    settle(engine);

    assert.equal(engine.portItem(ports[0]), 1);
});
