import {test} from "node:test";
import assert from "node:assert/strict";
import {EMPTY} from "@/sim/GameEngine.js";
import {makePipes} from "@/test/pipeFixture.js";
import {FLUID_TYPE_WATER, FLUID_TYPE_OIL} from "@/mods/Fluids/common/constants.js";

test("adjacent pipes group into one network per connected component", async () => {
    const {pipes} = await makePipes();
    pipes.placePipe(0, 0);
    pipes.placePipe(1, 0);
    pipes.placePipe(3, 0);

    assert.equal(pipes.networkAt(0, 0).size, 2, "adjacent pipes share a network");
    assert.equal(pipes.networkAt(0, 0).id, pipes.networkAt(1, 0).id);
    assert.equal(pipes.networkAt(3, 0).size, 1, "the gapped pipe is its own network");
    assert.notEqual(pipes.networkAt(0, 0).id, pipes.networkAt(3, 0).id);

    pipes.placePipe(2, 0);
    assert.equal(pipes.networkAt(0, 0).size, 4, "the bridging pipe merges the components");
    assert.equal(pipes.networkAt(0, 0).id, pipes.networkAt(3, 0).id);
});

// Pipe object ids run 1..4 on a fresh engine, in placement order.
test("removing an end pipe shrinks the network in place", async () => {
    const {pipes} = await makePipes();
    for (let x = 0; x < 4; x += 1) {
        pipes.placePipe(x, 0);
    }
    assert.equal(pipes.networkAt(1, 0).size, 4);

    pipes.removePipe(4);
    assert.equal(pipes.networkAt(0, 0).size, 3);
    assert.equal(pipes.networkAt(3, 0), null);
});

test("removing a middle pipe splits the run and shares the fluid out by size", async () => {
    const {pipes} = await makePipes();
    for (let x = 0; x < 4; x += 1) {
        pipes.placePipe(x, 0);
    }
    pipes.addFluid(0, 0, FLUID_TYPE_WATER, 6);
    pipes.removePipe(2);

    const left = pipes.networkAt(0, 0);
    const right = pipes.networkAt(2, 0);
    assert.equal(left.size, 1);
    assert.equal(right.size, 2);
    assert.notEqual(left.id, right.id);
    assert.equal(left.amount + right.amount, 6, "the split conserves the fluid");
    assert.equal(left.fluidType, FLUID_TYPE_WATER);
    assert.equal(right.fluidType, FLUID_TYPE_WATER);
});

test("a pipe line never crosses a chunk boundary", async () => {
    const {pipes} = await makePipes();
    for (const y of [62, 63, 64, 65]) {
        pipes.placePipe(0, y);
    }
    const above = pipes.networkAt(0, 63);
    const below = pipes.networkAt(0, 64);
    assert.equal(above.size, 2, "the line is two per-chunk networks");
    assert.equal(below.size, 2);
    assert.notEqual(above.id, below.id);
});

test("canJoin rejects a placement bridging networks of different fluids", async () => {
    const {pipes} = await makePipes();
    pipes.placePipe(0, 0);
    pipes.placePipe(2, 0);
    pipes.addFluid(0, 0, FLUID_TYPE_WATER, 2);
    pipes.addFluid(2, 0, FLUID_TYPE_OIL, 2);

    assert.equal(pipes.canJoin(1, 0), false, "water and oil must not merge");
    assert.equal(pipes.canJoin(3, 0), true, "extending one network is fine");

    assert.throws(() => pipes.addFluid(2, 0, FLUID_TYPE_WATER, 1), /already holds/);
});

test("a drained network frees its fluid type for the next fill", async () => {
    const {engine, pipes} = await makePipes();
    pipes.placePipe(0, 0);
    pipes.addFluid(0, 0, FLUID_TYPE_OIL, 0);
    assert.equal(pipes.networkAt(0, 0).fluidType, EMPTY, "a zero add binds no type");
    pipes.addFluid(0, 0, FLUID_TYPE_OIL, 2);
    assert.equal(pipes.networkAt(0, 0).fluidType, FLUID_TYPE_OIL);
    engine.tickAll();
    assert.equal(pipes.networkAt(0, 0).amount, 2, "nothing consumes, nothing leaves");
});
