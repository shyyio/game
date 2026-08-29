import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {chunkId} from "@/common/util.js";
import {LAYER_SURFACE} from "@/common/constants.js";
import {EMPTY} from "@/sim/GameEngine.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {makeGameEngine, makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {beltsOf} from "@/mods/Logistics/sim/testHelpers.js";
import {GateDefinition, BeltDefinition} from "@/mods/Logistics/common/objectTypes.js";
import {SetGateOpenMessage} from "@/mods/Logistics/common/messages.js";
import {GateSetEvent, GateSetBatchEvent} from "@/mods/Logistics/common/events.js";
import {PipeDefinition} from "@/mods/Fluids/common/objectTypes.js";
import {Pipes} from "@/mods/Fluids/sim/Pipes.js";
import {FLUID_TYPE_WATER, FLUID_TYPE_OIL} from "@/mods/Fluids/common/constants.js";

const RED = 3;

/**
 * Places a gate at (x, y) and returns its eid plus port lookups.
 */
function placeGate(engine, x, y, direction) {
    assert.equal(engine.applyMessage(new CreateObjectMessage(GateDefinition.typeId, x, y, direction)), true);
    const def = engine.components.get("Gate");
    const eid = def.eids[def.count - 1];
    const row = def.row(eid);
    return {eid, in: def.store.in[row], out: def.store.out[row]};
}

/**
 * Places a real (tracked) pipe, so gate adjacency rules see it.
 */
function placePipe(engine, x, y) {
    engine.applyMessage(new CreateObjectMessage(PipeDefinition.typeId, x, y, Direction.UP));
}

function gateBehavior(engine) {
    return engine.placed.behaviorFor(GateDefinition.typeId);
}

function gateMode(engine, eid) {
    const def = engine.components.get("Gate");
    return def.store.fluid[def.row(eid)];
}

test("an item flows through an open belt gate", async () => {
    const engine = await makeGameEngine();
    const belts = beltsOf(engine);
    // Belt at (5,6) UP feeds the gate at (5,5); belt at (5,4) carries onward.
    const feed = belts.placeBelt(5, 6, Direction.UP);
    const gate = placeGate(engine, 5, 5, Direction.UP);
    const onward = belts.placeBelt(5, 4, Direction.UP);

    assert.equal(gate.in, feed.outPort, "the gate adopted the feeding belt's out-port");
    assert.equal(gate.out, onward.inPort, "the onward belt adopted the gate's out-port");

    engine.setPortItem(feed.inPort, RED);
    let arrived = false;
    for (let i = 0; i < 12 && !arrived; i += 1) {
        engine.tickAll();
        arrived = engine.portItem(onward.outPort) === RED;
    }
    assert.ok(arrived, "the item passed the open gate onto the onward belt");
});

test("an item rests one tick inside the gate between the in- and out-port", async () => {
    const engine = await makeGameEngine();
    const belts = beltsOf(engine);
    const feed = belts.placeBelt(5, 6, Direction.UP);
    const gate = placeGate(engine, 5, 5, Direction.UP);
    belts.placeBelt(5, 4, Direction.UP);

    engine.setPortItem(feed.inPort, RED);
    let atMouth = false;
    for (let i = 0; i < 8 && !atMouth; i += 1) {
        engine.tickAll();
        atMouth = engine.portItem(gate.in) === RED;
    }
    assert.ok(atMouth, "the item reached the gate's in-port");

    engine.tickAll();
    assert.equal(engine.portItem(gate.in), EMPTY, "the item entered the gate");
    assert.equal(engine.portItem(gate.out), EMPTY, "the item rests inside, not on the out-port yet");

    engine.tickAll();
    assert.equal(engine.portItem(gate.out), RED, "the item surfaced on the out-port a tick later");
});

test("a closed belt gate jams the upstream belt and releases on open", async () => {
    const engine = await makeGameEngine();
    const belts = beltsOf(engine);
    const feed = belts.placeBelt(5, 6, Direction.UP);
    const gate = placeGate(engine, 5, 5, Direction.UP);
    const onward = belts.placeBelt(5, 4, Direction.UP);

    gateBehavior(engine).setOpen(engine, gate.eid, false);
    engine.setPortItem(feed.inPort, RED);
    for (let i = 0; i < 12; i += 1) {
        engine.tickAll();
    }
    assert.equal(engine.portItem(gate.in), RED, "the lead item rests on the closed gate's in-port");
    assert.equal(engine.portItem(gate.out), EMPTY, "nothing passed the closed gate");
    assert.equal(engine.portItem(onward.outPort), EMPTY);

    gateBehavior(engine).setOpen(engine, gate.eid, true);
    let arrived = false;
    for (let i = 0; i < 12 && !arrived; i += 1) {
        engine.tickAll();
        arrived = engine.portItem(onward.outPort) === RED;
    }
    assert.ok(arrived, "opening the gate released the jam");
});

test("a belt gate works across a chunk seam", async () => {
    const engine = await makeGameEngine();
    const belts = beltsOf(engine);
    // Feed belt in the chunk below the seam, gate and onward belt above it.
    const feed = belts.placeBelt(0, 64, Direction.UP);
    placeGate(engine, 0, 63, Direction.UP);
    const onward = belts.placeBelt(0, 62, Direction.UP);
    assert.notEqual(chunkId(0, 64), chunkId(0, 63), "the gate sits across the seam from its feed");

    engine.setPortItem(feed.inPort, RED);
    let arrived = false;
    for (let i = 0; i < 12 && !arrived; i += 1) {
        engine.tickAll();
        arrived = engine.portItem(onward.outPort) === RED;
    }
    assert.ok(arrived, "the item crossed the seam through the gate");
});

test("a gate placed against a pipe spawns in fluid mode and forwards fluid until closed", async () => {
    const engine = await makeGameEngine();
    const pipes = engine.resolve(Pipes);
    placePipe(engine, 0, 0);
    placePipe(engine, 1, 0);
    const gate = placeGate(engine, 2, 0, Direction.RIGHT);
    assert.equal(gateMode(engine, gate.eid), 1, "the adjacent pipe put the gate in fluid mode");
    placePipe(engine, 3, 0);
    placePipe(engine, 4, 0);

    pipes.addFluid(0, 0, FLUID_TYPE_WATER, 4);
    let forwarded = false;
    for (let i = 0; i < 12 && !forwarded; i += 1) {
        engine.tickAll();
        forwarded = pipes.networkAt(3, 0).amount > 0;
    }
    assert.ok(forwarded, "fluid crossed the open gate into the downstream network");
    assert.equal(pipes.networkAt(3, 0).fluidType, FLUID_TYPE_WATER);

    gateBehavior(engine).setOpen(engine, gate.eid, false);
    // A payload already resting on the out-port still lands; settle, then hold.
    for (let i = 0; i < 4; i += 1) {
        engine.tickAll();
    }
    const upstreamBefore = pipes.networkAt(0, 0).amount;
    const downstreamBefore = pipes.networkAt(3, 0).amount;
    for (let i = 0; i < 8; i += 1) {
        engine.tickAll();
    }
    assert.equal(pipes.networkAt(0, 0).amount, upstreamBefore, "the closed gate stops draining upstream");
    assert.equal(pipes.networkAt(3, 0).amount, downstreamBefore, "nothing more crossed the closed gate");
});

test("a closed fluid gate isolates different fluids on its two sides", async () => {
    const engine = await makeGameEngine();
    const pipes = engine.resolve(Pipes);
    placePipe(engine, 0, 0);
    const gate = placeGate(engine, 1, 0, Direction.RIGHT);
    placePipe(engine, 2, 0);
    gateBehavior(engine).setOpen(engine, gate.eid, false);

    pipes.addFluid(0, 0, FLUID_TYPE_WATER, 2);
    pipes.addFluid(2, 0, FLUID_TYPE_OIL, 2);
    for (let i = 0; i < 8; i += 1) {
        engine.tickAll();
    }
    assert.equal(pipes.networkAt(0, 0).fluidType, FLUID_TYPE_WATER);
    assert.equal(pipes.networkAt(0, 0).amount, 2);
    assert.equal(pipes.networkAt(2, 0).fluidType, FLUID_TYPE_OIL);
    assert.equal(pipes.networkAt(2, 0).amount, 2);
});

test("connecting a transport to an unconnected gate transforms its mode", async () => {
    const engine = await makeGameEngine();
    const gate = placeGate(engine, 5, 5, Direction.UP);
    assert.equal(gateMode(engine, gate.eid), 0, "an unconnected gate spawns in item mode");

    // A pipe behind the gate flips it to fluid mode.
    placePipe(engine, 5, 6);
    engine.tickAll();
    assert.equal(gateMode(engine, gate.eid), 1, "the coupled pipe transformed the gate");

    // Pipe gone, belt in front: back to item mode.
    engine.applyMessage(new DeleteObjectMessage(engine.occupantOwnerAt(5, 6, LAYER_SURFACE)));
    engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, 5, 4, Direction.UP));
    engine.tickAll();
    assert.equal(gateMode(engine, gate.eid), 0, "the coupled belt transformed the gate back");
});

test("the guard rejects coupling one transport kind while the other side holds the other", async () => {
    const engine = await makeGameEngine();
    // Belt behind the gate: an item connection.
    engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, 5, 6, Direction.UP));
    placeGate(engine, 5, 5, Direction.UP);

    // A pipe in front must be rejected.
    placePipe(engine, 5, 4);
    assert.equal(engine.occupantOwnerAt(5, 4, LAYER_SURFACE), null, "the conflicting pipe was not placed");

    // The reverse: pipe behind, belt in front rejected.
    const pipes = engine.resolve(Pipes);
    placePipe(engine, 10, 6);
    const other = placeGate(engine, 10, 5, Direction.DOWN);
    assert.equal(gateMode(engine, other.eid), 1, "pipe-fed gate is fluid");
    engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, 10, 4, Direction.DOWN));
    assert.equal(engine.occupantOwnerAt(10, 4, LAYER_SURFACE), null, "the conflicting belt was not placed");
    assert.equal(pipes.networkAt(10, 6).size, 1, "the pipe network is untouched");
});

test("a toggle applies at the next tick, batches the change, and syncs to late joiners", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), player);
    game.dispatchMessage(new SetViewportMessage([chunk]), player);
    game.dispatchMessage(new CreateObjectMessage(GateDefinition.typeId, 5, 5, Direction.UP), player);
    const engine = game.simEngine;
    const def = engine.components.get("Gate");
    const eid = def.eids[def.count - 1];
    const objectId = engine.placed.objectIdOf(eid);

    player.events.length = 0;
    game.dispatchMessage(new SetGateOpenMessage(objectId, 0), player);
    assert.equal(def.store.open[def.row(eid)], 1, "the toggle is buffered, not instantaneous");
    game.runTick();
    assert.equal(def.store.open[def.row(eid)], 0, "the tick applied the buffered toggle");
    const batch = player.events.find(event => event instanceof GateSetBatchEvent);
    assert.ok(batch, "the tick's delta batch fanned out to the chunk's viewers");
    const change = batch.explode().find(event => event.objectId === objectId);
    assert.equal(change.open, 0);
    assert.equal(change.fluid, 0);

    // A redundant set applies with no delta, so no batch goes out.
    player.events.length = 0;
    game.dispatchMessage(new SetGateOpenMessage(objectId, 0), player);
    game.runTick();
    assert.equal(player.events.find(event => event instanceof GateSetBatchEvent), undefined);

    // A late joiner learns the closed gate through chunk sync.
    const joiner = new CapturingSession(2);
    game.connect(joiner);
    game.dispatchMessage(new SetViewportMessage([chunk]), joiner);
    const bundle = joiner.events.find(event => event.events !== undefined);
    const synced = bundle.events.filter(event => event instanceof GateSetBatchEvent);
    assert.equal(synced.length, 1);
    const syncedGate = synced[0].explode()[0];
    assert.equal(syncedGate.objectId, objectId);
    assert.equal(syncedGate.open, 0);
});

test("a toggle without build rights is refused with a corrective event", async () => {
    const game = await makeGame();
    const owner = new CapturingSession(1);
    game.connect(owner);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), owner);
    game.dispatchMessage(new CreateObjectMessage(GateDefinition.typeId, 5, 5, Direction.UP), owner);
    const engine = game.simEngine;
    const def = engine.components.get("Gate");
    const eid = def.eids[def.count - 1];
    const objectId = engine.placed.objectIdOf(eid);

    const intruder = new CapturingSession(2);
    game.connect(intruder);
    intruder.events.length = 0;
    game.dispatchMessage(new SetGateOpenMessage(objectId, 0), intruder);
    game.runTick();
    assert.equal(def.store.open[def.row(eid)], 1, "the foreign toggle was refused");
    const corrective = intruder.events.find(event => event instanceof GateSetEvent);
    assert.ok(corrective, "the sender got the authoritative state back");
    assert.equal(corrective.objectId, objectId);
    assert.equal(corrective.open, 1);
});

test("gate state survives a save/load", async () => {
    const store = new NodeSaveStore(":memory:");
    const game = await makeGame([], store);
    const player = new CapturingSession(1);
    game.connect(player);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), player);
    game.dispatchMessage(new CreateObjectMessage(GateDefinition.typeId, 5, 5, Direction.UP), player);
    const engine = game.simEngine;
    const def = engine.components.get("Gate");
    const eid = def.eids[def.count - 1];
    const objectId = engine.placed.objectIdOf(eid);
    game.dispatchMessage(new SetGateOpenMessage(objectId, 0), player);
    game.runTick();
    await game.save();

    const restored = await makeGame([], store);
    assert.equal(await restored.load(), true);
    const restoredDef = restored.simEngine.components.get("Gate");
    assert.equal(restoredDef.count, 1);
    assert.equal(restoredDef.store.open[0], 0, "the closed state came back");
    assert.equal(restoredDef.store.fluid[0], 0, "the mode column persisted");
});
