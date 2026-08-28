import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {chunkId} from "@/common/util.js";
import {makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {
    GateDefinition,
    PoleDefinition,
    ControlTerminalDefinition,
} from "@/mods/Logistics/common/objectTypes.js";
import {WireLinkMessage, WireUnlinkMessage, ControlSnapshotRequestMessage} from "@/mods/Logistics/common/messages.js";
import {ControlSnapshotEvent} from "@/mods/Logistics/common/events.js";
import {ControlNetworks} from "@/mods/Logistics/sim/ControlNetworks.js";
import {POLE_NONE, CONTROL_TIER_BASE} from "@/mods/Logistics/common/constants.js";

/**
 * Places an object and returns its objectId (the newest placed row's).
 */
function place(engine, type, x, y, direction=Direction.UP) {
    assert.equal(engine.applyMessage(new CreateObjectMessage(type.typeId, x, y, direction)), true);
    const def = engine.placed.def;
    return def.store.objectId[def.row(def.eids[def.count - 1])];
}

/**
 * A connected session holding build rights on the chunk at (5, 5).
 */
function claimedPlayer(game) {
    const player = new CapturingSession(1);
    game.connect(player);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), player);
    return player;
}

test("a network accepts only one terminal", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const networks = engine.resolve(ControlNetworks);
    const poleA = place(engine, PoleDefinition, 5, 5);
    const poleB = place(engine, PoleDefinition, 12, 5);
    const terminalA = place(engine, ControlTerminalDefinition, 6, 5);
    const terminalB = place(engine, ControlTerminalDefinition, 11, 5);

    game.dispatchMessage(new WireLinkMessage(terminalA, poleA), player);
    assert.equal(networks.poleOf(engine.placed.eidByObjectId(terminalA)), poleA);

    game.dispatchMessage(new WireLinkMessage(terminalB, poleA), player);
    assert.equal(
        networks.poleOf(engine.placed.eidByObjectId(terminalB)), POLE_NONE,
        "a second terminal on the same network is refused",
    );

    game.dispatchMessage(new WireLinkMessage(terminalB, poleB), player);
    assert.equal(networks.poleOf(engine.placed.eidByObjectId(terminalB)), poleB);

    game.dispatchMessage(new WireLinkMessage(poleA, poleB), player);
    assert.equal(networks.hasWire(poleA, poleB), false, "a wire merging two terminal'd networks is refused");

    game.dispatchMessage(new WireUnlinkMessage(terminalA, poleA), player);
    game.dispatchMessage(new WireLinkMessage(poleA, poleB), player);
    assert.equal(networks.hasWire(poleA, poleB), true, "one side's terminal gone, the merge is legal");
});

test("a terminal may relink within its own network", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const networks = engine.resolve(ControlNetworks);
    const poleA = place(engine, PoleDefinition, 5, 5);
    const poleB = place(engine, PoleDefinition, 12, 5);
    const terminal = place(engine, ControlTerminalDefinition, 6, 5);
    game.dispatchMessage(new WireLinkMessage(poleA, poleB), player);
    game.dispatchMessage(new WireLinkMessage(terminal, poleA), player);

    game.dispatchMessage(new WireLinkMessage(terminal, poleB), player);
    assert.equal(networks.poleOf(engine.placed.eidByObjectId(terminal)), poleB);
});

test("removing a terminal frees its network for a new one", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const networks = engine.resolve(ControlNetworks);
    const pole = place(engine, PoleDefinition, 5, 5);
    const terminalA = place(engine, ControlTerminalDefinition, 6, 5);
    const terminalB = place(engine, ControlTerminalDefinition, 8, 5);
    game.dispatchMessage(new WireLinkMessage(terminalA, pole), player);

    engine.applyMessage(new DeleteObjectMessage(terminalA));
    game.dispatchMessage(new WireLinkMessage(terminalB, pole), player);
    assert.equal(networks.poleOf(engine.placed.eidByObjectId(terminalB)), pole);
});

test("the snapshot lists the network's devices, excluding the terminal itself", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const pole = place(engine, PoleDefinition, 5, 5);
    const terminal = place(engine, ControlTerminalDefinition, 6, 5);
    const gate = place(engine, GateDefinition, 8, 5, Direction.UP);
    game.dispatchMessage(new WireLinkMessage(terminal, pole), player);
    game.dispatchMessage(new WireLinkMessage(gate, pole), player);

    player.events.length = 0;
    game.dispatchMessage(new ControlSnapshotRequestMessage(terminal), player);
    const snapshot = player.events.find(event => event instanceof ControlSnapshotEvent);
    assert.ok(snapshot, "the snapshot answered the requesting session");
    assert.equal(snapshot.objectId, terminal);
    assert.equal(snapshot.linked, 1);
    assert.equal(snapshot.tier, CONTROL_TIER_BASE);
    assert.deepEqual(snapshot.deviceObjectIds, [gate]);
    assert.deepEqual(snapshot.deviceTypeIds, [GateDefinition.typeId]);
    assert.deepEqual(snapshot.deviceTileXs, [8]);
    assert.deepEqual(snapshot.deviceTileYs, [5]);
});

test("an unwired terminal's snapshot reports unlinked and empty", async () => {
    const game = await makeGame();
    const player = claimedPlayer(game);
    const engine = game.simEngine;
    const terminal = place(engine, ControlTerminalDefinition, 6, 5);

    game.dispatchMessage(new ControlSnapshotRequestMessage(terminal), player);
    const snapshot = player.events.find(event => event instanceof ControlSnapshotEvent);
    assert.ok(snapshot);
    assert.equal(snapshot.linked, 0);
    assert.deepEqual(snapshot.deviceObjectIds, []);

    player.events.length = 0;
    game.dispatchMessage(new ControlSnapshotRequestMessage(999999), player);
    assert.equal(
        player.events.find(event => event instanceof ControlSnapshotEvent), undefined,
        "an unknown target is ignored",
    );
});
