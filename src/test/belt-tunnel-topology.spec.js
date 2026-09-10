import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {DeleteObjectMessage} from "@/common/CoreMessages.js";
import {MAX_UNDERGROUND_LENGTH} from "@/mods/logistics/common/constants.js";
import {BeltTunnelDownType, BeltTunnelUpType, BeltUndergroundType} from "@/mods/logistics/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {placeBelt, beltLaneAt, laneItemCount} from "@/test/beltFixture.js";

const RED = 1;

// Places a tunnel-down at (1,1) then a tunnel-up `gap+1` tiles east, filling the buried span; returns the
// engine and both mouth refs. A RIGHT tunnel.
async function tunnel(gap) {
    const engine = await makeGameEngine();
    placeBelt(engine, 1, 1, Direction.RIGHT, BeltTunnelDownType);
    const downRef = engine.placed.objectRefOf(engine.placed.eidsOf(BeltTunnelDownType.objectTypeId)[0]);
    const exitX = 1 + gap + 1;
    placeBelt(engine, exitX, 1, Direction.RIGHT, BeltTunnelUpType);
    const upRef = engine.placed.objectRefOf(engine.placed.eidsOf(BeltTunnelUpType.objectTypeId)[0]);
    return {engine, downRef, upRef, exitX};
}

function connected(engine, ax, ay, bx, by) {
    return beltLaneAt(engine, ax, ay).laneRef === beltLaneAt(engine, bx, by).laneRef;
}

function beltCount(engine) {
    return [BeltTunnelDownType, BeltTunnelUpType, BeltUndergroundType]
        .reduce((sum, type) => sum + engine.placed.eidsOf(type.objectTypeId).length, 0);
}

test("adjacent mouths connect into one tunnel lane", async () => {
    const {engine, exitX} = await tunnel(0);
    assert.ok(connected(engine, 1, 1, exitX, 1), "the two mouths are one lane");
    assert.equal(beltCount(engine), 2, "no undergrounds between adjacent mouths");
});

test("mouths connect at the maximum tunnel length", async () => {
    const {engine, exitX} = await tunnel(MAX_UNDERGROUND_LENGTH);
    assert.ok(connected(engine, 1, 1, exitX, 1), "mouths at max span still connect");
    assert.equal(beltCount(engine), MAX_UNDERGROUND_LENGTH + 2);
});

test("mouths beyond the maximum tunnel length do not connect", async () => {
    const {engine, exitX} = await tunnel(MAX_UNDERGROUND_LENGTH + 1);
    assert.ok(!connected(engine, 1, 1, exitX, 1), "over-long mouths stay separate");
    assert.equal(engine.lanes.ids().length, 2);
});

test("a reversed pair (tunnel-up first, then tunnel-down) connects", async () => {
    const engine = await makeGameEngine();
    placeBelt(engine, 3, 1, Direction.RIGHT, BeltTunnelUpType);
    placeBelt(engine, 1, 1, Direction.RIGHT, BeltTunnelDownType);

    assert.ok(connected(engine, 1, 1, 3, 1), "the reversed pair forms one tunnel lane");
    assert.equal(engine.lanes.ids().length, 1);
});

test("deleting the up mouth collapses the tunnel, leaving the down mouth", async () => {
    const {engine, upRef} = await tunnel(1);
    engine.applyMessage(new DeleteObjectMessage(upRef));

    assert.equal(beltCount(engine), 1, "the tunnel-up and its undergrounds are gone");
    assert.equal(engine.lanes.ids().length, 1);
    assert.equal(engine.lanes.cellsOf(beltLaneAt(engine, 1, 1).laneRef).length, 1, "the surviving tunnel-down is a standalone belt");
});

test("deleting the down mouth collapses the tunnel, leaving the up mouth", async () => {
    const {engine, downRef, exitX} = await tunnel(1);
    engine.applyMessage(new DeleteObjectMessage(downRef));

    assert.equal(beltCount(engine), 1, "the tunnel-down and its undergrounds are gone");
    assert.equal(engine.lanes.ids().length, 1);
    assert.equal(engine.lanes.cellsOf(beltLaneAt(engine, exitX, 1).laneRef).length, 1);
});

test("a tunnel item is kept on the surviving mouth when a mouth is deleted", async () => {
    const {engine, upRef} = await tunnel(1);
    const lane = beltLaneAt(engine, 1, 1);
    engine.ports.setItem(lane.inPort, RED);
    engine.tickAll(); // ingest the item into the tunnel
    assert.equal(laneItemCount(engine), 1, "the item is in the tunnel");

    engine.applyMessage(new DeleteObjectMessage(upRef));
    assert.equal(laneItemCount(engine), 1, "the item is kept on the surviving mouth, not lost with the tunnel");
});
