import {EMPTY} from "@/sim/AbstractComponent.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {GameEngine} from "@/sim/GameEngine.js";
import {ProbeSystem} from "@/test/ecsSim.js";

const ITEM = 1;

// Boots an engine with `count` ports; the eids in `filledIds` (1-based, matching creation order)
// carry ITEM.
async function setup(count, filledIds) {
    const engine = new GameEngine();
    await engine.init();
    const ports = [];
    for (let i = 0; i < count; i += 1) {
        let item = EMPTY;
        if (filledIds.includes(i + 1)) {
            item = ITEM;
        }
        ports.push(engine.ports.create(item));
    }
    return {engine, ports};
}

// Submits from SUBMIT_INTENTS and runs one whole tick, so the resolver's own systems drive the
// resolution and the commit.
function tick(engine, submit) {
    engine.registerSystem(new ProbeSystem({submitIntents: submit}));
    engine.tick();
}

test("resolves a packed transfer chain as a single shift when the end drains", async () => {
    const {engine, ports} = await setup(4, [1, 2, 3]);

    tick(engine, () => {
        engine.transfers.submitTransfer(ports[0], ports[1], false);
        engine.transfers.submitTransfer(ports[1], ports[2], false);
        engine.transfers.submitTransfer(ports[2], ports[3], true);
    });

    assert.equal(engine.transfers.getResolvedEdges(), `${ports[0]}->${ports[1]}, ${ports[1]}->${ports[2]}, ${ports[2]}->${ports[3]}`);
    assert.equal(engine.ports.getItemByPortEid(ports[0]), EMPTY);
    assert.equal(engine.ports.getItemByPortEid(ports[3]), ITEM);
});

test("resolves a packed chain the tail drains out of", async () => {
    const {engine, ports} = await setup(3, [1, 2, 3]);

    tick(engine, () => {
        engine.transfers.submitTransfer(ports[0], ports[1], false);
        engine.transfers.submitTransfer(ports[1], ports[2], false);
        engine.transfers.submitDrain(ports[2]);
    });

    assert.equal(engine.transfers.getResolvedEdges(), `${ports[0]}->${ports[1]}, ${ports[1]}->${ports[2]}`);
    assert.equal(engine.ports.getItemByPortEid(ports[0]), EMPTY);
});

test("resolves no transfer when the chain's end is blocked", async () => {
    const {engine, ports} = await setup(4, [1, 2, 3, 4]);

    tick(engine, () => {
        engine.transfers.submitTransfer(ports[0], ports[1], false);
        engine.transfers.submitTransfer(ports[1], ports[2], false);
        engine.transfers.submitTransfer(ports[2], ports[3], false);
    });

    assert.equal(engine.transfers.getResolvedEdges(), "");
});

test("a fan-out source moves into its best-ranked destination only", async () => {
    const {engine, ports} = await setup(3, [1]);

    tick(engine, () => {
        engine.transfers.submitTransfer(ports[0], ports[1], true, 1);
        engine.transfers.submitTransfer(ports[0], ports[2], true, 0);
    });

    assert.equal(engine.transfers.getResolvedEdges(), `${ports[0]}->${ports[2]}`);
    assert.equal(engine.ports.getItemByPortEid(ports[1]), EMPTY);
    assert.equal(engine.ports.getItemByPortEid(ports[2]), ITEM);
});

test("a contested destination takes the lowest-ranked contender", async () => {
    const {engine, ports} = await setup(3, [1, 2]);

    tick(engine, () => {
        engine.transfers.submitTransfer(ports[0], ports[2], true, 1);
        engine.transfers.submitTransfer(ports[1], ports[2], true, 0);
    });

    assert.equal(engine.transfers.getResolvedEdges(), `${ports[1]}->${ports[2]}`);
    assert.equal(engine.ports.getItemByPortEid(ports[0]), ITEM);
    assert.equal(engine.ports.getItemByPortEid(ports[1]), EMPTY);
});

test("translates the item type on a transfer via output_item", async () => {
    const {engine, ports} = await setup(2, [1]);

    tick(engine, () => {
        engine.transfers.submitTransfer(ports[0], ports[1], true, EMPTY, 99);
    });

    assert.equal(engine.ports.getItemByPortEid(ports[0]), EMPTY);
    assert.equal(engine.ports.getItemByPortEid(ports[1]), 99);
});

test("creates a brand-new item with a source-less intent", async () => {
    const {engine, ports} = await setup(1, []);

    tick(engine, () => {
        engine.transfers.submitCreate(ports[0], 55, true);
    });

    assert.equal(engine.ports.getItemByPortEid(ports[0]), 55);
    assert.equal(engine.transfers.isDest(ports[0]), true);
});

test("a drain empties its source", async () => {
    const {engine, ports} = await setup(1, [1]);

    tick(engine, () => {
        engine.transfers.submitDrain(ports[0]);
    });

    assert.equal(engine.ports.getItemByPortEid(ports[0]), EMPTY);
});

// A sink drains before POST_RESOLVE, so a producer feeding the same port refills it the same tick.
test("a drained sink is empty by POST_RESOLVE", async () => {
    const {engine, ports} = await setup(1, [1]);
    let itemAtPostResolve = ITEM;
    engine.registerSystem(new ProbeSystem({postResolve: () => {
        itemAtPostResolve = engine.ports.getItemByPortEid(ports[0]);
    }}));

    tick(engine, () => {
        engine.transfers.submitDrain(ports[0]);
    });

    assert.equal(itemAtPostResolve, EMPTY);
});

// A resolved source is cleared before POST_RESOLVE, so a transport refilling it the same tick is
// not wiped by the commit.
test("a transfer's source is cleared before POST_RESOLVE", async () => {
    const {engine, ports} = await setup(2, [1]);
    const [source, dest] = ports;
    const NEXT_ITEM = 8;
    engine.registerSystem(new ProbeSystem({postResolve: () => {
        if (engine.ports.getItemByPortEid(source) === EMPTY) {
            engine.ports.setItem(source, NEXT_ITEM);
        }
    }}));

    tick(engine, () => {
        engine.transfers.submitTransfer(source, dest, true);
    });

    assert.equal(engine.ports.getItemByPortEid(dest), ITEM);
    assert.equal(engine.ports.getItemByPortEid(source), NEXT_ITEM);
});

// The destination fills after the POST_RESOLVE systems ran, so a consumer reading it there still
// sees last tick's item and every landed item rests a visible tick.
test("a transfer fills its destination after POST_RESOLVE", async () => {
    const {engine, ports} = await setup(2, [1]);
    let itemAtPostResolve = EMPTY;
    engine.registerSystem(new ProbeSystem({postResolve: () => {
        itemAtPostResolve = engine.ports.getItemByPortEid(ports[1]);
    }}));

    tick(engine, () => {
        engine.transfers.submitTransfer(ports[0], ports[1], true);
    });

    assert.equal(itemAtPostResolve, EMPTY);
    assert.equal(engine.ports.getItemByPortEid(ports[1]), ITEM);
});

test("a submitted intent reports whether it resolved", async () => {
    const {engine, ports} = await setup(1, []);
    let first = EMPTY;
    let second = EMPTY;

    tick(engine, () => {
        first = engine.transfers.submitCreate(ports[0], ITEM, true);
        second = engine.transfers.submitCreate(ports[0], ITEM + 1, true);
    });

    assert.equal(engine.transfers.isIntentResolved(first), true);
    assert.equal(engine.transfers.isIntentResolved(second), false);
});
