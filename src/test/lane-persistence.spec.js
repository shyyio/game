import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {EMPTY} from "@/sim/sentinels.js";
import {ModPackage} from "@/common/ModPackage.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {
    LaneFixtureDeclaration,
    ITEM_TYPE_TEST_CARGO,
    placeLane,
    laneAt,
    itemCells,
} from "@/test/laneFixture.js";

const CARGO = ITEM_TYPE_TEST_CARGO;
// A line straddling the y=64 chunk border, so the save covers a seam-joined chain of two lanes.
const CELLS = [62, 63, 64, 65];

async function setup() {
    return makeGameEngine([new ModPackage(new LaneFixtureDeclaration())]);
}

function build(engine) {
    for (const y of CELLS) {
        placeLane(engine, 0, y, Direction.UP);
    }
    return {
        inputPort: engine.lanes.inputPortOf(laneAt(engine, 0, 65)),
        outputPort: engine.lanes.outputPortOf(laneAt(engine, 0, 62)),
    };
}

test("lane state survives a serialize and deserialize round-trip mid-flight", async () => {
    const a = await setup();
    const aPorts = build(a);
    a.ports.setItem(aPorts.inputPort, CARGO);
    for (let i = 0; i < 4; i += 1) {
        a.ports.setItem(aPorts.outputPort, EMPTY);
        a.tick();
    }

    const serialized = JSON.parse(JSON.stringify(a.snapshots.serialize()));
    const b = await setup();
    b.snapshots.deserialize(serialized);

    assert.equal(b.lanes.ids().length, a.lanes.ids().length, "the same lanes come back");
    assert.equal(itemCells(b), itemCells(a), "with the same items on them");

    const bPorts = {
        inputPort: b.lanes.inputPortOf(laneAt(b, 0, 65)),
        outputPort: b.lanes.outputPortOf(laneAt(b, 0, 62)),
    };
    const aStream = [];
    const bStream = [];
    for (let i = 0; i < 12; i += 1) {
        a.ports.setItem(aPorts.outputPort, EMPTY);
        b.ports.setItem(bPorts.outputPort, EMPTY);
        a.tick();
        b.tick();
        aStream.push(a.ports.item(aPorts.outputPort));
        bStream.push(b.ports.item(bPorts.outputPort));
    }

    assert.deepEqual(bStream, aStream, "the restored engine produces the same output stream");
    assert.ok(aStream.includes(CARGO), "the in-flight item eventually pops out");
});

test("lane state persists through a save store and reloads", async () => {
    const a = await setup();
    const aPorts = build(a);
    a.ports.setItem(aPorts.inputPort, CARGO);
    a.tick();

    const store = new NodeSaveStore(":memory:");
    await store.save(a.snapshots.serialize());
    const loaded = await store.load();

    const b = await setup();
    b.snapshots.deserialize(loaded);

    assert.equal(b.lanes.ids().length, a.lanes.ids().length);
    const outputPort = b.lanes.outputPortOf(laneAt(b, 0, 62));
    let delivered = false;
    for (let i = 0; i < 12 && !delivered; i += 1) {
        b.ports.setItem(outputPort, EMPTY);
        b.tick();
        delivered = b.ports.item(outputPort) === CARGO;
    }
    assert.ok(delivered, "the reloaded item flows to the output");
});

// An item whose type the loadout no longer declares is dropped on load, and the slots it held fold
// into the gap of the item behind it, so the rest of the file still arrives.
test("an item of a type that no longer exists is dropped on load", async () => {
    const GONE = 9998;
    const a = await setup();
    const aPorts = build(a);
    for (let i = 0; i < 6; i += 1) {
        a.ports.setItem(aPorts.inputPort, CARGO);
        a.ports.setItem(aPorts.outputPort, EMPTY);
        a.tick();
    }
    const carried = itemCells(a);
    assert.ok(carried >= 2, "several items are in flight");

    // Retype one saved item to something no mod declares.
    const serialized = JSON.parse(JSON.stringify(a.snapshots.serialize()));
    const items = serialized.components.find(component => component.name === "LaneItem");
    items.rows[0].itemTypeId = GONE;

    const b = await setup();
    b.snapshots.deserialize(serialized);

    assert.equal(itemCells(b), carried - 1, "the unknown item is dropped");
    // The seam port is one slot of the chain, so an item resting there is in flight too.
    const seam = b.lanes.inputPortOf(laneAt(b, 0, 62));
    const inFlight = itemCells(b) + (b.ports.item(seam) === CARGO ? 1 : 0);
    const outputPort = b.lanes.outputPortOf(laneAt(b, 0, 62));
    let delivered = 0;
    for (let i = 0; i < 24; i += 1) {
        b.ports.setItem(outputPort, EMPTY);
        b.tick();
        if (b.ports.item(outputPort) === CARGO) {
            delivered += 1;
        }
    }
    assert.equal(delivered, inFlight, "every surviving item still arrives");
});
