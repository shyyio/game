import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, SetViewportMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {chunkId} from "@/common/util.js";
import {EMPTY} from "@/sim/sentinels.js";
import {ObjectFieldsEvent, ObjectFieldsBatchEvent} from "@/common/ObjectEvents.js";
import {makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {GateDefinition} from "@/mods/logistics/common/objectTypes.js";

/**
 * Places a gate in a claimed, viewed chunk and returns what the sync tests need.
 */
function placeGate(game, player, x, y) {
    const chunk = chunkId(x, y);
    game.dispatchMessage(new ClaimChunkMessage(chunk), player);
    game.dispatchMessage(new SetViewportMessage([chunk]), player);
    game.dispatchMessage(new CreateObjectMessage(GateDefinition.objectTypeId, x, y, Direction.UP), player);
    const engine = game.simEngine;
    const def = engine.components.get("Gate");
    const eid = def.eids[def.count - 1];
    return {engine, def, eid, chunk, objectId: engine.placed.objectIdOf(eid)};
}

test("a marked row's synced fields batch per chunk at tick end, to the chunk's viewers only", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    const gate = placeGate(game, player, 5, 5);
    const {engine, def, eid} = gate;

    player.events.length = 0;
    def.store.open[def.row(eid)] = 0;
    engine.sync.markDirty(def, eid);
    assert.equal(player.events.find(event => event instanceof ObjectFieldsBatchEvent), undefined, "nothing until the tick ends");
    game.runTick();
    const batch = player.events.find(event => event instanceof ObjectFieldsBatchEvent);
    assert.ok(batch, "the tick's deltas fanned out to the chunk's viewers");
    const change = batch.explode().find(event => event.id === gate.objectId);
    assert.deepEqual(change.values, [0, 0, EMPTY], "open, fluid, lastOutput: the behavior's declared order");

    // A second tick with no mark sends nothing.
    player.events.length = 0;
    game.runTick();
    assert.equal(player.events.find(event => event instanceof ObjectFieldsBatchEvent), undefined);

    // A mark on an unobserved chunk builds no event.
    const far = new CapturingSession(2);
    game.connect(far);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(300, 300)), far);
    game.dispatchMessage(new CreateObjectMessage(GateDefinition.objectTypeId, 300, 300, Direction.UP), far);
    const farEid = def.eids[def.count - 1];
    player.events.length = 0;
    far.events.length = 0;
    def.store.open[def.row(farEid)] = 0;
    engine.sync.markDirty(def, farEid);
    game.runTick();
    assert.equal(far.events.find(event => event instanceof ObjectFieldsBatchEvent), undefined);
    assert.equal(player.events.find(event => event instanceof ObjectFieldsBatchEvent), undefined);
});

test("chunk sync carries every row off its defaults, after the objects themselves", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    const gate = placeGate(game, player, 5, 5);
    const {engine, def, eid} = gate;
    def.store.open[def.row(eid)] = 0;
    engine.sync.markDirty(def, eid);
    game.runTick();
    // A second gate at its defaults stays out of the sync.
    game.dispatchMessage(new CreateObjectMessage(GateDefinition.objectTypeId, 6, 5, Direction.UP), player);

    const joiner = new CapturingSession(2);
    game.connect(joiner);
    game.dispatchMessage(new SetViewportMessage([gate.chunk]), joiner);
    const bundle = joiner.events.find(event => event.events !== undefined);
    const objectsAt = bundle.events.findIndex(event => event.ids !== undefined);
    const fieldsAt = bundle.events.findIndex(event => event instanceof ObjectFieldsBatchEvent);
    assert.ok(objectsAt >= 0 && fieldsAt > objectsAt, "the fields follow the objects they patch");
    const synced = bundle.events[fieldsAt].explode();
    assert.equal(synced.length, 1);
    assert.equal(synced[0].id, gate.objectId);
    assert.deepEqual(synced[0].values, [0, 0, EMPTY]);
});

test("eventFor builds one row's current values as a single event", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    const gate = placeGate(game, player, 5, 5);
    const event = gate.engine.sync.eventFor(gate.def, gate.eid);
    assert.ok(event instanceof ObjectFieldsEvent);
    assert.equal(event.id, gate.objectId);
    assert.equal(event.x, 5);
    assert.equal(event.y, 5);
    assert.deepEqual(event.values, [1, 0, EMPTY]);
});

test("marks whose values net to what the client already holds emit nothing", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    const gate = placeGate(game, player, 5, 5);
    const {engine, def, eid} = gate;
    player.events.length = 0;
    def.store.open[def.row(eid)] = 0;
    engine.sync.markDirty(def, eid);
    def.store.open[def.row(eid)] = 1;
    engine.sync.markDirty(def, eid);
    game.runTick();
    assert.equal(player.events.find(event => event instanceof ObjectFieldsBatchEvent), undefined);
});

test("after a load the engine knows what a chunk sync told the client, so a change back to the default emits", async () => {
    const store = new NodeSaveStore(":memory:");
    const game = await makeGame([], store);
    const player = new CapturingSession(1);
    game.connect(player);
    const gate = placeGate(game, player, 5, 5);
    gate.def.store.open[gate.def.row(gate.eid)] = 0;
    gate.engine.sync.markDirty(gate.def, gate.eid);
    game.runTick();
    await game.save();

    const restored = await makeGame([], store);
    assert.equal(await restored.load(), true);
    const joiner = new CapturingSession(2);
    restored.connect(joiner);
    restored.dispatchMessage(new SetViewportMessage([gate.chunk]), joiner);
    const engine = restored.simEngine;
    const def = engine.components.get("Gate");
    const eid = def.eids[0];
    joiner.events.length = 0;
    def.store.open[def.row(eid)] = 1;
    engine.sync.markDirty(def, eid);
    restored.runTick();
    const batch = joiner.events.find(event => event instanceof ObjectFieldsBatchEvent);
    assert.ok(batch, "the reopened gate reached the viewer");
    assert.deepEqual(batch.explode()[0].values, [1, 0, EMPTY]);
});
