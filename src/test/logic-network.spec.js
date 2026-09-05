import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage, SetViewportMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {chunkId} from "@/common/util.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {makeGameEngine, makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {GateDefinition, PoleDefinition, BeltDefinition} from "@/mods/logistics/common/objectTypes.js";
import {WireLinkMessage, WireUnlinkMessage} from "@/mods/logistics/common/messages.js";
import {LogicWireSetEvent, LogicWireClearEvent} from "@/mods/logistics/common/events.js";
import {LogicNetworks} from "@/mods/logistics/sim/LogicNetworks.js";

/**
 * Places an object and returns its objectId (the newest placed row's).
 */
function place(engine, type, x, y, direction=Direction.UP) {
    assert.equal(engine.applyMessage(new CreateObjectMessage(type.typeId, x, y, direction)), true);
    const def = engine.placed.def;
    return def.store.objectId[def.row(def.eids[def.count - 1])];
}

test("poles connect only through explicit wires", async () => {
    const engine = await makeGameEngine();
    const networks = engine.resolve(LogicNetworks);
    const a = place(engine, PoleDefinition, 0, 0);
    const b = place(engine, PoleDefinition, 8, 0);
    const c = place(engine, PoleDefinition, 16, 0);

    assert.equal(networks.networks.length, 3, "unwired in-range poles stay separate");

    networks.wire(a, b);
    assert.equal(networks.networks.length, 2, "the wire merged the endpoints");
    assert.equal(networks.networkOf(a).id, networks.networkOf(b).id);

    networks.wire(b, c);
    assert.equal(networks.networks.length, 1);
    assert.deepEqual(networks.networkOf(a).poleIds, [a, b, c].sort((x, y) => x - y));

    networks.unwire(a, b);
    assert.equal(networks.networks.length, 2, "removing the wire split the component");
    assert.notEqual(networks.networkOf(a).id, networks.networkOf(c).id);
});

test("removing a pole drops its wires and splits its component", async () => {
    const engine = await makeGameEngine();
    const networks = engine.resolve(LogicNetworks);
    const a = place(engine, PoleDefinition, 0, 0);
    const bridge = place(engine, PoleDefinition, 8, 0);
    const c = place(engine, PoleDefinition, 16, 0);
    networks.wire(a, bridge);
    networks.wire(bridge, c);
    assert.equal(networks.networks.length, 1);

    engine.applyMessage(new DeleteObjectMessage(bridge));
    assert.equal(networks.networks.length, 2, "the bridge's removal split the component");
    assert.equal(networks.hasWire(a, bridge), false, "its wires went with it");
});

test("a wired logic network spans chunk seams", async () => {
    const engine = await makeGameEngine();
    const networks = engine.resolve(LogicNetworks);
    const a = place(engine, PoleDefinition, 0, 60);
    const b = place(engine, PoleDefinition, 0, 68);
    assert.notEqual(chunkId(0, 60), chunkId(0, 68), "the poles sit in different chunks");
    networks.wire(a, b);
    assert.equal(networks.networkOf(a).id, networks.networkOf(b).id);
});

test("a pole-pole wire message round-trips, toggles off, and respects range", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), player);
    game.dispatchMessage(new SetViewportMessage([chunk]), player);
    const engine = game.simEngine;
    const networks = engine.resolve(LogicNetworks);
    const a = place(engine, PoleDefinition, 5, 5);
    const b = place(engine, PoleDefinition, 12, 5);
    const far = place(engine, PoleDefinition, 30, 5);

    player.events.length = 0;
    game.dispatchMessage(new WireLinkMessage(a, b), player);
    assert.equal(networks.hasWire(a, b), true);
    const set = player.events.find(event => event instanceof LogicWireSetEvent);
    assert.ok(set, "the wire fanned out to the chunk's viewers");
    assert.equal(set.aObjectId, a);
    assert.equal(set.bObjectId, b);

    player.events.length = 0;
    game.dispatchMessage(new WireUnlinkMessage(a, b), player);
    assert.equal(networks.hasWire(a, b), false);
    assert.ok(player.events.find(event => event instanceof LogicWireClearEvent));

    game.dispatchMessage(new WireLinkMessage(a, far), player);
    assert.equal(networks.hasWire(a, far), false, "an out-of-range wire is refused");
});

test("a wire joins a gate to a pole's network; unwiring and pole removal detach it", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), player);
    game.dispatchMessage(new SetViewportMessage([chunk]), player);
    const engine = game.simEngine;
    const gateId = place(engine, GateDefinition, 5, 5, Direction.UP);
    const poleId = place(engine, PoleDefinition, 8, 5);
    const networks = engine.resolve(LogicNetworks);

    player.events.length = 0;
    game.dispatchMessage(new WireLinkMessage(gateId, poleId), player);
    assert.deepEqual(networks.networkOf(poleId).deviceIds, [gateId]);
    const set = player.events.find(event => event instanceof LogicWireSetEvent);
    assert.ok(set, "the wire fanned out to the chunk's viewers");

    player.events.length = 0;
    game.dispatchMessage(new WireUnlinkMessage(gateId, poleId), player);
    assert.equal(networks.networkOf(gateId), null);
    assert.deepEqual(networks.networkOf(poleId).deviceIds, []);
    assert.ok(player.events.find(event => event instanceof LogicWireClearEvent));

    // Re-wire, then removing the pole clears the wire too.
    game.dispatchMessage(new WireLinkMessage(gateId, poleId), player);
    player.events.length = 0;
    engine.applyMessage(new DeleteObjectMessage(poleId));
    assert.equal(networks.networkOf(gateId), null);
    assert.ok(player.events.find(event => event instanceof LogicWireClearEvent));
});

test("devices wire to each other directly, poles optional", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), player);
    const engine = game.simEngine;
    const networks = engine.resolve(LogicNetworks);
    const gateA = place(engine, GateDefinition, 5, 5, Direction.UP);
    const gateB = place(engine, GateDefinition, 8, 5, Direction.UP);

    game.dispatchMessage(new WireLinkMessage(gateA, gateB), player);
    assert.equal(networks.hasWire(gateA, gateB), true, "a gate-gate wire holds");
    const network = networks.networkOf(gateA);
    assert.equal(network.id, networks.networkOf(gateB).id);
    assert.deepEqual(network.poleIds, [], "no pole involved");

    // Removing one endpoint sweeps the wire.
    engine.applyMessage(new DeleteObjectMessage(gateB));
    assert.equal(networks.hasWire(gateA, gateB), false);
    assert.equal(networks.networkOf(gateA), null);
});

test("wiring rejects a non-wireable device and an out-of-range pole", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), player);
    const engine = game.simEngine;
    const networks = engine.resolve(LogicNetworks);
    const beltId = place(engine, BeltDefinition, 5, 7, Direction.UP);
    const gateId = place(engine, GateDefinition, 5, 5, Direction.UP);
    const nearPole = place(engine, PoleDefinition, 8, 5);
    const farPole = place(engine, PoleDefinition, 30, 5);

    game.dispatchMessage(new WireLinkMessage(beltId, nearPole), player);
    assert.equal(networks.hasWire(beltId, nearPole), false, "a belt is not wireable");

    game.dispatchMessage(new WireLinkMessage(gateId, farPole), player);
    assert.equal(networks.hasWire(gateId, farPole), false, "the pole is out of range");
});

test("poles and wires survive a save/load", async () => {
    const store = new NodeSaveStore(":memory:");
    const game = await makeGame([], store);
    const player = new CapturingSession(1);
    game.connect(player);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), player);
    const engine = game.simEngine;
    const gateId = place(engine, GateDefinition, 5, 5, Direction.UP);
    const poleId = place(engine, PoleDefinition, 8, 5);
    const otherPoleId = place(engine, PoleDefinition, 12, 5);
    game.dispatchMessage(new WireLinkMessage(gateId, poleId), player);
    game.dispatchMessage(new WireLinkMessage(poleId, otherPoleId), player);
    await game.save();

    const restored = await makeGame([], store);
    assert.equal(await restored.load(), true);
    const networks = restored.simEngine.resolve(LogicNetworks);
    assert.equal(networks.hasWire(poleId, otherPoleId), true, "the pole wire persisted");
    const network = networks.networkOf(poleId);
    assert.deepEqual(network.poleIds, [poleId, otherPoleId].sort((x, y) => x - y));
    assert.deepEqual(network.deviceIds, [gateId], "the device wire persisted");
});

test("a late joiner learns the chunk's wires through chunk sync", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), player);
    const engine = game.simEngine;
    const gateId = place(engine, GateDefinition, 5, 5, Direction.UP);
    const poleId = place(engine, PoleDefinition, 8, 5);
    const otherPoleId = place(engine, PoleDefinition, 12, 5);
    game.dispatchMessage(new WireLinkMessage(gateId, poleId), player);
    game.dispatchMessage(new WireLinkMessage(poleId, otherPoleId), player);

    const joiner = new CapturingSession(2);
    game.connect(joiner);
    game.dispatchMessage(new SetViewportMessage([chunk]), joiner);
    const bundle = joiner.events.find(event => event.events !== undefined);
    const wires = bundle.events.filter(event => event instanceof LogicWireSetEvent);
    assert.equal(wires.length, 2, "both wires synced once each for the shared chunk");
    const keys = wires.map(event => `${event.aObjectId}:${event.bObjectId}`).sort();
    assert.deepEqual(keys, [`${gateId}:${poleId}`, `${poleId}:${otherPoleId}`].sort());
});
