import {EMPTY} from "@/sim/AbstractComponent.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {chunkKeyAt} from "@/common/util.js";
import {LAYER_SURFACE} from "@/common/constants.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {makeGameEngine, makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {placeBelt, beltLaneAt} from "@/test/beltFixture.js";
import {GateType, BeltType} from "@/mods/logistics/common/objectTypes.js";
import {SetGateOpenMessage} from "@/mods/logistics/common/messages.js";
import {ObjectFieldsEvent, ObjectFieldsBatchEvent} from "@/common/ObjectEvents.js";
import {PipeType} from "@/mods/fluids/common/objectTypes.js";
import {PipeNetworkIndex} from "@/mods/fluids/sim/PipeNetworkIndex.js";
import {FLUID_TYPE_WATER, FLUID_TYPE_OIL} from "@/mods/fluids/common/constants.js";

const RED = 3;

/**
 * Places a gate at (x, y) and returns its eid plus port lookups.
 */
function placeGate(engine, x, y, direction) {
    assert.equal(engine.applyMessage(new CreateObjectMessage(GateType.objectTypeId, x, y, direction)), true);
    const def = engine.components.getComponentByName("Gate");
    const eid = def.eids[def.count - 1];
    const row = def.getRowByEid(eid);
    return {eid, inputPort: def.store.inputPort[row], outputPort: def.store.outputPort[row]};
}

/**
 * Places a real (tracked) pipe, so gate adjacency rules see it.
 */
function placePipe(engine, x, y) {
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, x, y, Direction.UP));
}

function gateBehavior(engine) {
    return engine.placed.getBehaviorByTypeId(GateType.objectTypeId);
}

function gateMode(engine, eid) {
    const def = engine.components.getComponentByName("Gate");
    return def.store.fluid[def.getRowByEid(eid)];
}

test("an item flows through an open belt gate", async () => {
    const engine = await makeGameEngine();
    // Belt at (5,6) UP feeds the gate at (5,5); belt at (5,4) carries onward.
    placeBelt(engine, 5, 6, Direction.UP);
    const gate = placeGate(engine, 5, 5, Direction.UP);
    placeBelt(engine, 5, 4, Direction.UP);
    const feed = beltLaneAt(engine, 5, 6);
    const onward = beltLaneAt(engine, 5, 4);

    assert.equal(gate.inputPort, feed.outputPort, "the gate adopted the feeding belt's output port");
    assert.equal(gate.outputPort, onward.inputPort, "the onward belt adopted the gate's output port");

    engine.ports.setItem(feed.inputPort, RED);
    let arrived = false;
    for (let i = 0; i < 12 && !arrived; i += 1) {
        engine.tick();
        arrived = engine.ports.getItemByPortEid(onward.outputPort) === RED;
    }
    assert.ok(arrived, "the item passed the open gate onto the onward belt");
});

test("an item rests one tick inside the gate between the in- and output port", async () => {
    const engine = await makeGameEngine();
    placeBelt(engine, 5, 6, Direction.UP);
    const gate = placeGate(engine, 5, 5, Direction.UP);
    placeBelt(engine, 5, 4, Direction.UP);
    const feed = beltLaneAt(engine, 5, 6);

    engine.ports.setItem(feed.inputPort, RED);
    let atMouth = false;
    for (let i = 0; i < 8 && !atMouth; i += 1) {
        engine.tick();
        atMouth = engine.ports.getItemByPortEid(gate.inputPort) === RED;
    }
    assert.ok(atMouth, "the item reached the gate's input port");

    engine.tick();
    assert.equal(engine.ports.getItemByPortEid(gate.inputPort), EMPTY, "the item entered the gate");
    assert.equal(engine.ports.getItemByPortEid(gate.outputPort), EMPTY, "the item rests inside, not on the output port yet");

    engine.tick();
    assert.equal(engine.ports.getItemByPortEid(gate.outputPort), RED, "the item surfaced on the output port a tick later");
});

test("a closed belt gate jams the upstream belt and releases on open", async () => {
    const engine = await makeGameEngine();
    placeBelt(engine, 5, 6, Direction.UP);
    const gate = placeGate(engine, 5, 5, Direction.UP);
    placeBelt(engine, 5, 4, Direction.UP);
    const feed = beltLaneAt(engine, 5, 6);
    const onward = beltLaneAt(engine, 5, 4);

    gateBehavior(engine).setOpen(engine, gate.eid, false);
    engine.ports.setItem(feed.inputPort, RED);
    for (let i = 0; i < 12; i += 1) {
        engine.tick();
    }
    assert.equal(engine.ports.getItemByPortEid(gate.inputPort), RED, "the lead item rests on the closed gate's input port");
    assert.equal(engine.ports.getItemByPortEid(gate.outputPort), EMPTY, "nothing passed the closed gate");
    assert.equal(engine.ports.getItemByPortEid(onward.outputPort), EMPTY);

    gateBehavior(engine).setOpen(engine, gate.eid, true);
    let arrived = false;
    for (let i = 0; i < 12 && !arrived; i += 1) {
        engine.tick();
        arrived = engine.ports.getItemByPortEid(onward.outputPort) === RED;
    }
    assert.ok(arrived, "opening the gate released the jam");
});

test("a belt gate works across a chunk seam", async () => {
    const engine = await makeGameEngine();
    // Feed belt in the chunk below the seam, gate and onward belt above it.
    placeBelt(engine, 0, 64, Direction.UP);
    placeGate(engine, 0, 63, Direction.UP);
    placeBelt(engine, 0, 62, Direction.UP);
    const feed = beltLaneAt(engine, 0, 64);
    const onward = beltLaneAt(engine, 0, 62);
    assert.notEqual(chunkKeyAt(0, 64), chunkKeyAt(0, 63), "the gate sits across the seam from its feed");

    engine.ports.setItem(feed.inputPort, RED);
    let arrived = false;
    for (let i = 0; i < 12 && !arrived; i += 1) {
        engine.tick();
        arrived = engine.ports.getItemByPortEid(onward.outputPort) === RED;
    }
    assert.ok(arrived, "the item crossed the seam through the gate");
});

test("a gate placed against a pipe spawns in fluid mode and forwards fluid until closed", async () => {
    const engine = await makeGameEngine();
    const pipes = engine.resolve(PipeNetworkIndex);
    placePipe(engine, 0, 0);
    placePipe(engine, 1, 0);
    const gate = placeGate(engine, 2, 0, Direction.RIGHT);
    assert.equal(gateMode(engine, gate.eid), 1, "the adjacent pipe put the gate in fluid mode");
    placePipe(engine, 3, 0);
    placePipe(engine, 4, 0);

    pipes.addFluid(0, 0, FLUID_TYPE_WATER, 4);
    let forwarded = false;
    for (let i = 0; i < 12 && !forwarded; i += 1) {
        engine.tick();
        forwarded = pipes.getNetworkAtOrNull(3, 0).amount > 0;
    }
    assert.ok(forwarded, "fluid crossed the open gate into the downstream network");
    assert.equal(pipes.getNetworkAtOrNull(3, 0).fluidType, FLUID_TYPE_WATER);

    gateBehavior(engine).setOpen(engine, gate.eid, false);
    // A payload already resting on the output port still lands; settle, then hold.
    for (let i = 0; i < 4; i += 1) {
        engine.tick();
    }
    const upstreamBefore = pipes.getNetworkAtOrNull(0, 0).amount;
    const downstreamBefore = pipes.getNetworkAtOrNull(3, 0).amount;
    for (let i = 0; i < 8; i += 1) {
        engine.tick();
    }
    assert.equal(pipes.getNetworkAtOrNull(0, 0).amount, upstreamBefore, "the closed gate stops draining upstream");
    assert.equal(pipes.getNetworkAtOrNull(3, 0).amount, downstreamBefore, "nothing more crossed the closed gate");
});

test("a closed fluid gate isolates different fluids on its two sides", async () => {
    const engine = await makeGameEngine();
    const pipes = engine.resolve(PipeNetworkIndex);
    placePipe(engine, 0, 0);
    const gate = placeGate(engine, 1, 0, Direction.RIGHT);
    placePipe(engine, 2, 0);
    gateBehavior(engine).setOpen(engine, gate.eid, false);

    pipes.addFluid(0, 0, FLUID_TYPE_WATER, 2);
    pipes.addFluid(2, 0, FLUID_TYPE_OIL, 2);
    for (let i = 0; i < 8; i += 1) {
        engine.tick();
    }
    assert.equal(pipes.getNetworkAtOrNull(0, 0).fluidType, FLUID_TYPE_WATER);
    assert.equal(pipes.getNetworkAtOrNull(0, 0).amount, 2);
    assert.equal(pipes.getNetworkAtOrNull(2, 0).fluidType, FLUID_TYPE_OIL);
    assert.equal(pipes.getNetworkAtOrNull(2, 0).amount, 2);
});

test("connecting a transport to an unconnected gate transforms its mode", async () => {
    const engine = await makeGameEngine();
    const gate = placeGate(engine, 5, 5, Direction.UP);
    assert.equal(gateMode(engine, gate.eid), 0, "an unconnected gate spawns in item mode");

    // A pipe behind the gate flips it to fluid mode.
    placePipe(engine, 5, 6);
    engine.tick();
    assert.equal(gateMode(engine, gate.eid), 1, "the coupled pipe transformed the gate");

    // Pipe gone, belt in front: back to item mode.
    engine.applyMessage(new DeleteObjectMessage(engine.space.getOwnerAt(5, 6, LAYER_SURFACE)));
    engine.applyMessage(new CreateObjectMessage(BeltType.objectTypeId, 5, 4, Direction.UP));
    engine.tick();
    assert.equal(gateMode(engine, gate.eid), 0, "the coupled belt transformed the gate back");
});

test("the guard rejects coupling one transport kind while the other side holds the other", async () => {
    const engine = await makeGameEngine();
    // Belt behind the gate: an item connection.
    engine.applyMessage(new CreateObjectMessage(BeltType.objectTypeId, 5, 6, Direction.UP));
    placeGate(engine, 5, 5, Direction.UP);

    // A pipe in front must be rejected.
    placePipe(engine, 5, 4);
    assert.equal(engine.space.getOwnerAt(5, 4, LAYER_SURFACE), null, "the conflicting pipe was not placed");

    // The reverse: pipe behind, belt in front rejected.
    const pipes = engine.resolve(PipeNetworkIndex);
    placePipe(engine, 10, 6);
    const other = placeGate(engine, 10, 5, Direction.DOWN);
    assert.equal(gateMode(engine, other.eid), 1, "pipe-fed gate is fluid");
    engine.applyMessage(new CreateObjectMessage(BeltType.objectTypeId, 10, 4, Direction.DOWN));
    assert.equal(engine.space.getOwnerAt(10, 4, LAYER_SURFACE), null, "the conflicting belt was not placed");
    assert.equal(pipes.getNetworkAtOrNull(10, 6).size, 1, "the pipe network is untouched");
});

test("a toggle applies at the next tick, batches the change, and syncs to late joiners", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    const chunkKey = chunkKeyAt(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunkKey), player);
    game.dispatchMessage(new SetViewportMessage([chunkKey]), player);
    game.dispatchMessage(new CreateObjectMessage(GateType.objectTypeId, 5, 5, Direction.UP), player);
    const engine = game.simEngine;
    const def = engine.components.getComponentByName("Gate");
    const eid = def.eids[def.count - 1];
    const objectRef = engine.placed.getObjectRefByEid(eid);

    player.events.length = 0;
    game.dispatchMessage(new SetGateOpenMessage(objectRef, false), player);
    assert.equal(def.store.open[def.getRowByEid(eid)], 1, "the toggle is buffered, not instantaneous");
    game.runTick();
    assert.equal(def.store.open[def.getRowByEid(eid)], 0, "the tick applied the buffered toggle");
    const batch = player.events.find(event => event instanceof ObjectFieldsBatchEvent);
    assert.ok(batch, "the tick's delta batch fanned out to the chunk's viewers");
    const change = batch.explode().find(event => event.objectRef === objectRef);
    assert.deepEqual(change.values, [0, 0, EMPTY], "open, fluid, lastOutput");

    // A redundant set applies with no delta, so no batch goes out.
    player.events.length = 0;
    game.dispatchMessage(new SetGateOpenMessage(objectRef, false), player);
    game.runTick();
    assert.equal(player.events.find(event => event instanceof ObjectFieldsBatchEvent), undefined);

    // A late joiner learns the closed gate through chunk sync.
    const joiner = new CapturingSession(2);
    game.connect(joiner);
    game.dispatchMessage(new SetViewportMessage([chunkKey]), joiner);
    const bundle = joiner.events.find(event => event.events !== undefined);
    const synced = bundle.events.filter(event => event instanceof ObjectFieldsBatchEvent);
    assert.equal(synced.length, 1);
    const syncedGate = synced[0].explode()[0];
    assert.equal(syncedGate.objectRef, objectRef);
    assert.deepEqual(syncedGate.values, [0, 0, EMPTY]);
});

test("a toggle without build rights is refused with a corrective event", async () => {
    const game = await makeGame();
    const owner = new CapturingSession(1);
    game.connect(owner);
    game.dispatchMessage(new ClaimChunkMessage(chunkKeyAt(5, 5)), owner);
    game.dispatchMessage(new CreateObjectMessage(GateType.objectTypeId, 5, 5, Direction.UP), owner);
    const engine = game.simEngine;
    const def = engine.components.getComponentByName("Gate");
    const eid = def.eids[def.count - 1];
    const objectRef = engine.placed.getObjectRefByEid(eid);

    const intruder = new CapturingSession(2);
    game.connect(intruder);
    intruder.events.length = 0;
    game.dispatchMessage(new SetGateOpenMessage(objectRef, false), intruder);
    game.runTick();
    assert.equal(def.store.open[def.getRowByEid(eid)], 1, "the foreign toggle was refused");
    const corrective = intruder.events.find(event => event instanceof ObjectFieldsEvent);
    assert.ok(corrective, "the sender got the authoritative state back");
    assert.equal(corrective.objectRef, objectRef);
    assert.deepEqual(corrective.values, [1, 0, EMPTY]);
});

test("gate state survives a save/load", async () => {
    const store = new NodeSaveStore(":memory:");
    const game = await makeGame([], store);
    const player = new CapturingSession(1);
    game.connect(player);
    game.dispatchMessage(new ClaimChunkMessage(chunkKeyAt(5, 5)), player);
    game.dispatchMessage(new CreateObjectMessage(GateType.objectTypeId, 5, 5, Direction.UP), player);
    const engine = game.simEngine;
    const def = engine.components.getComponentByName("Gate");
    const eid = def.eids[def.count - 1];
    const objectRef = engine.placed.getObjectRefByEid(eid);
    game.dispatchMessage(new SetGateOpenMessage(objectRef, false), player);
    game.runTick();
    await game.save();

    const restored = await makeGame([], store);
    assert.equal(await restored.load(), true);
    const restoredDef = restored.simEngine.components.getComponentByName("Gate");
    assert.equal(restoredDef.count, 1);
    assert.equal(restoredDef.store.open[0], 0, "the closed state came back");
    assert.equal(restoredDef.store.fluid[0], 0, "the mode column persisted");
});
