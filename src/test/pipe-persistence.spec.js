import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {pipesOf} from "@/mods/Fluids/sim/testHelpers.js";
import {FLUID_TYPE_WATER} from "@/mods/Fluids/common/constants.js";
import {PipeDefinition, TankDefinition} from "@/mods/Fluids/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";

async function populated() {
    const engine = await makeGameEngine();
    // The 2x2 tank at (0, 0) covers (0..1, 0..1) and is fed from (0, 2) through its bottom-left tile.
    engine.applyMessage(new CreateObjectMessage(PipeDefinition.typeId, 0, 2, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(PipeDefinition.typeId, 0, 3, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(TankDefinition.typeId, 0, 0, Direction.UP));
    // A second, disjoint network across the chunk border.
    engine.applyMessage(new CreateObjectMessage(PipeDefinition.typeId, 5, 63, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(PipeDefinition.typeId, 5, 64, Direction.UP));
    const pipes = pipesOf(engine);
    pipes.addFluid(0, 2, FLUID_TYPE_WATER, 4);
    for (let i = 0; i < 4; i += 1) {
        engine.tickAll();
    }
    return engine;
}

function tankState(engine) {
    const def = engine.component("Tank");
    const row = def.row(engine.placed.eidsOf(TankDefinition.typeId)[0]);
    return {fluidType: def.store.fluidType[row], amount: def.store.amount[row]};
}

test("pipe networks and fluid state round-trip through the engine serializer", async () => {
    const engine = await populated();
    const pipes = pipesOf(engine);
    const netBefore = pipes.networkAt(0, 2);
    const tankBefore = tankState(engine);
    const snapshot = JSON.parse(JSON.stringify(engine.serialize()));

    const restored = await makeGameEngine();
    restored.deserialize(snapshot);
    const restoredPipes = pipesOf(restored);

    const net = restoredPipes.networkAt(0, 2);
    assert.equal(net.id, netBefore.id, "the network id (first member) is stable");
    assert.equal(net.size, netBefore.size);
    assert.equal(net.amount, netBefore.amount, "buffered fluid restored");
    assert.equal(net.fluidType, netBefore.fluidType);
    assert.deepEqual(tankState(restored), tankBefore, "tank state restored");
    assert.equal(restoredPipes.networkAt(5, 63).size, 1, "the seam networks stay per-chunk");
    assert.equal(restoredPipes.networkAt(5, 64).size, 1);

    // The restored network keeps draining into the tank.
    for (let i = 0; i < 20; i += 1) {
        restored.tickAll();
    }
    assert.equal(restoredPipes.networkAt(0, 2).amount, 0, "restored network still flows");
    const outPort = restored.portAt(1, -1, Direction.UP);
    assert.equal(tankState(restored).amount + 1, 4, "all units end in the tank plus its out-port payload");
    assert.equal(restored.portItem(outPort), FLUID_TYPE_WATER);
});

test("deleting a pipe through the generic path relinks the networks", async () => {
    const engine = await makeGameEngine();
    for (let x = 0; x < 3; x += 1) {
        engine.applyMessage(new CreateObjectMessage(PipeDefinition.typeId, x, 0, Direction.UP));
    }
    const pipes = pipesOf(engine);
    assert.equal(pipes.networkAt(0, 0).size, 3);

    const middleEid = engine.placed.eidsOf(PipeDefinition.typeId)
        .find(eid => engine.Position.x[eid] === 1 && engine.Position.y[eid] === 0);
    engine.applyMessage(new DeleteObjectMessage(engine.placed.objectIdOf(middleEid)));

    assert.equal(pipes.networkAt(0, 0).size, 1);
    assert.equal(pipes.networkAt(2, 0).size, 1);
    assert.equal(pipes.networkAt(1, 0), null);
    assert.equal(pipes.pipeCount, 2);
});
