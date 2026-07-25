import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {MAX_UNDERGROUND_LENGTH} from "@/mods/Logistics/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {BeltRampDownDefinition, BeltRampUpDefinition} from "@/mods/Logistics/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {beltsOf} from "@/mods/Logistics/sim/testHelpers.js";

const RED = 1;

// Places a ramp-down at (1,1) then a ramp-up `gap+1` tiles east, filling the buried span; returns the
// engine and both ramp ids. A RIGHT tunnel.
async function tunnel(gap) {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BeltRampDownDefinition.typeId, 1, 1, Direction.RIGHT));
    const downId = beltsOf(engine)._beltAt(1, 1, Direction.RIGHT).id;
    const exitX = 1 + gap + 1;
    engine.applyMessage(new CreateObjectMessage(BeltRampUpDefinition.typeId, exitX, 1, Direction.RIGHT));
    const upId = beltsOf(engine)._beltAt(exitX, 1, Direction.RIGHT).id;
    return {engine, downId, upId, exitX};
}

function connected(engine, ax, ay, bx, by) {
    const a = beltsOf(engine).pathAt(ax, ay);
    const b = beltsOf(engine).pathAt(bx, by);
    return a !== null && b !== null && a.id === b.id;
}

function itemCells(engine) {
    const belts = beltsOf(engine);
    return belts.paths.reduce((sum, path) => sum + belts.itemCountOf(path), 0);
}

test("adjacent ramps connect into one tunnel path", async () => {
    const {engine, exitX} = await tunnel(0);
    assert.ok(connected(engine, 1, 1, exitX, 1), "the two ramps are one path");
    assert.equal(beltsOf(engine).beltCount, 2, "no undergrounds between adjacent ramps");
});

test("ramps connect at the maximum tunnel length", async () => {
    const {engine, exitX} = await tunnel(MAX_UNDERGROUND_LENGTH);
    assert.ok(connected(engine, 1, 1, exitX, 1), "ramps at max span still connect");
    assert.equal(beltsOf(engine).beltCount, MAX_UNDERGROUND_LENGTH + 2);
});

test("ramps beyond the maximum tunnel length do not connect", async () => {
    const {engine, exitX} = await tunnel(MAX_UNDERGROUND_LENGTH + 1);
    assert.ok(!connected(engine, 1, 1, exitX, 1), "over-long ramps stay separate");
    assert.equal(beltsOf(engine).paths.length, 2);
});

test("a reversed pair (ramp-up first, then ramp-down) connects", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BeltRampUpDefinition.typeId, 3, 1, Direction.RIGHT));
    engine.applyMessage(new CreateObjectMessage(BeltRampDownDefinition.typeId, 1, 1, Direction.RIGHT));

    assert.ok(connected(engine, 1, 1, 3, 1), "the reversed pair forms one tunnel path");
    assert.equal(beltsOf(engine).paths.length, 1);
});

test("deleting the up ramp collapses the tunnel, leaving the down ramp", async () => {
    const {engine, upId} = await tunnel(1);
    engine.applyMessage(new DeleteObjectMessage(upId));

    assert.equal(beltsOf(engine).beltCount, 1, "the ramp-up and its undergrounds are gone");
    assert.equal(beltsOf(engine).paths.length, 1);
    assert.equal(beltsOf(engine).paths[0].length, 1, "the surviving ramp-down is a standalone belt");
});

test("deleting the down ramp collapses the tunnel, leaving the up ramp", async () => {
    const {engine, downId} = await tunnel(1);
    engine.applyMessage(new DeleteObjectMessage(downId));

    assert.equal(beltsOf(engine).beltCount, 1, "the ramp-down and its undergrounds are gone");
    assert.equal(beltsOf(engine).paths.length, 1);
    assert.equal(beltsOf(engine).paths[0].length, 1);
});

test("a tunnel item is kept on the surviving ramp when a ramp is deleted", async () => {
    const {engine, upId} = await tunnel(1);
    const path = beltsOf(engine).pathAt(1, 1);
    engine.setPortItem(path.inPort, RED);
    engine.tickAll(); // ingest the item into the tunnel
    assert.equal(itemCells(engine), 1, "the item is in the tunnel");

    engine.applyMessage(new DeleteObjectMessage(upId));
    assert.equal(itemCells(engine), 1, "the item is kept on the surviving ramp, not lost with the tunnel");
});
