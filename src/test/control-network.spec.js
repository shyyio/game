import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage, SetViewportMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {chunkId} from "@/common/util.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {makeGameEngine, makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {GateDefinition, PoleDefinition, BeltDefinition} from "@/mods/Logistics/common/objectTypes.js";
import {WireLinkMessage, WireUnlinkMessage} from "@/mods/Logistics/common/messages.js";
import {
    ControlLinkSetEvent,
    ControlLinkClearEvent,
    ControlWireSetEvent,
    ControlWireClearEvent,
} from "@/mods/Logistics/common/events.js";
import {ControlNetworks} from "@/mods/Logistics/sim/ControlNetworks.js";
import {POLE_NONE} from "@/mods/Logistics/common/constants.js";

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
    const networks = engine.resolve(ControlNetworks);
    const a = place(engine, PoleDefinition, 0, 0);
    const b = place(engine, PoleDefinition, 8, 0);
    const c = place(engine, PoleDefinition, 16, 0);

    assert.equal(networks.networks.length, 3, "unwired in-range poles stay separate");

    networks.wirePoles(a, b);
    assert.equal(networks.networks.length, 2, "the wire merged the endpoints");
    assert.equal(networks.networkOf(a).id, networks.networkOf(b).id);

    networks.wirePoles(b, c);
    assert.equal(networks.networks.length, 1);
    assert.deepEqual(networks.networkOf(a).poleIds, [a, b, c].sort((x, y) => x - y));

    networks.unwirePoles(a, b);
    assert.equal(networks.networks.length, 2, "removing the wire split the component");
    assert.notEqual(networks.networkOf(a).id, networks.networkOf(c).id);
});

test("removing a pole drops its wires and splits its component", async () => {
    const engine = await makeGameEngine();
    const networks = engine.resolve(ControlNetworks);
    const a = place(engine, PoleDefinition, 0, 0);
    const bridge = place(engine, PoleDefinition, 8, 0);
    const c = place(engine, PoleDefinition, 16, 0);
    networks.wirePoles(a, bridge);
    networks.wirePoles(bridge, c);
    assert.equal(networks.networks.length, 1);

    engine.applyMessage(new DeleteObjectMessage(bridge));
    assert.equal(networks.networks.length, 2, "the bridge's removal split the component");
    assert.equal(networks.hasWire(a, bridge), false, "its wires went with it");
});

test("a wired control network spans chunk seams", async () => {
    const engine = await makeGameEngine();
    const networks = engine.resolve(ControlNetworks);
    const a = place(engine, PoleDefinition, 0, 60);
    const b = place(engine, PoleDefinition, 0, 68);
    assert.notEqual(chunkId(0, 60), chunkId(0, 68), "the poles sit in different chunks");
    networks.wirePoles(a, b);
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
    const networks = engine.resolve(ControlNetworks);
    const a = place(engine, PoleDefinition, 5, 5);
    const b = place(engine, PoleDefinition, 12, 5);
    const far = place(engine, PoleDefinition, 30, 5);

    player.events.length = 0;
    game.dispatchMessage(new WireLinkMessage(a, b), player);
    assert.equal(networks.hasWire(a, b), true);
    const set = player.events.find(event => event instanceof ControlWireSetEvent);
    assert.ok(set, "the wire fanned out to the chunk's viewers");
    assert.equal(set.aObjectId, a);
    assert.equal(set.bObjectId, b);

    player.events.length = 0;
    game.dispatchMessage(new WireUnlinkMessage(a, b), player);
    assert.equal(networks.hasWire(a, b), false);
    assert.ok(player.events.find(event => event instanceof ControlWireClearEvent));

    game.dispatchMessage(new WireLinkMessage(a, far), player);
    assert.equal(networks.hasWire(a, far), false, "an out-of-range wire is refused");
});

test("a wire joins a gate to a pole's network; unlink and pole removal detach it", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), player);
    game.dispatchMessage(new SetViewportMessage([chunk]), player);
    const engine = game.simEngine;
    const gateId = place(engine, GateDefinition, 5, 5, Direction.UP);
    const poleId = place(engine, PoleDefinition, 8, 5);
    const networks = engine.resolve(ControlNetworks);

    player.events.length = 0;
    game.dispatchMessage(new WireLinkMessage(gateId, poleId), player);
    assert.equal(networks.poleOf(engine.placed.eidByObjectId(gateId)), poleId);
    assert.deepEqual(networks.networkOf(poleId).deviceIds, [gateId]);
    const set = player.events.find(event => event instanceof ControlLinkSetEvent);
    assert.ok(set, "the wire fanned out to the chunk's viewers");
    assert.equal(set.deviceObjectId, gateId);
    assert.equal(set.poleObjectId, poleId);

    player.events.length = 0;
    game.dispatchMessage(new WireUnlinkMessage(gateId, poleId), player);
    assert.equal(networks.poleOf(engine.placed.eidByObjectId(gateId)), POLE_NONE);
    assert.deepEqual(networks.networkOf(poleId).deviceIds, []);
    assert.ok(player.events.find(event => event instanceof ControlLinkClearEvent));

    // Re-wire, then removing the pole clears the wire too.
    game.dispatchMessage(new WireLinkMessage(gateId, poleId), player);
    player.events.length = 0;
    engine.applyMessage(new DeleteObjectMessage(poleId));
    assert.equal(networks.poleOf(engine.placed.eidByObjectId(gateId)), POLE_NONE);
    assert.ok(player.events.find(event => event instanceof ControlLinkClearEvent));
});

test("wiring rejects a non-wireable device and an out-of-range pole", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), player);
    const engine = game.simEngine;
    const networks = engine.resolve(ControlNetworks);
    const beltId = place(engine, BeltDefinition, 5, 7, Direction.UP);
    const gateId = place(engine, GateDefinition, 5, 5, Direction.UP);
    const nearPole = place(engine, PoleDefinition, 8, 5);
    const farPole = place(engine, PoleDefinition, 30, 5);

    game.dispatchMessage(new WireLinkMessage(beltId, nearPole), player);
    assert.equal(networks.poleOf(engine.placed.eidByObjectId(beltId)), POLE_NONE, "a belt is not wireable");

    game.dispatchMessage(new WireLinkMessage(gateId, farPole), player);
    assert.equal(networks.poleOf(engine.placed.eidByObjectId(gateId)), POLE_NONE, "the pole is out of range");
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
    const networks = restored.simEngine.resolve(ControlNetworks);
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
    const links = bundle.events.filter(event => event instanceof ControlLinkSetEvent);
    assert.equal(links.length, 1);
    assert.equal(links[0].deviceObjectId, gateId);
    const wires = bundle.events.filter(event => event instanceof ControlWireSetEvent);
    assert.equal(wires.length, 1, "the pole wire synced once for the shared chunk");
    assert.equal(wires[0].aObjectId, poleId);
    assert.equal(wires[0].bObjectId, otherPoleId);
});
