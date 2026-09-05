import {test} from "node:test";
import assert from "node:assert/strict";

import {Game} from "@/sim/Game.js";
import {GameAPI} from "@/sim/GameAPI.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {CHUNK_SIZE, REGION_SIZE, Direction} from "@/common/constants.js";
import {CreateObjectMessage, OverworldRequestMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {OverworldSnapshotEvent} from "@/common/OverworldEvents.js";
import {PlayerNamesEvent} from "@/common/PlayerEvents.js";
import {chunkId} from "@/common/util.js";
import {BeltDefinition} from "@/mods/logistics/common/objectTypes.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";

test("a session with no chunk subscriptions gets an overworld snapshot on request", async () => {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry));
    await game.init();

    const session = new CapturingSession();
    game.connect(session);

    game.dispatchMessage(new CreateObjectMessage(BeltDefinition.typeId, 3, 2, Direction.UP), session);
    game.dispatchMessage(new OverworldRequestMessage(-1, -1, 2, 2), session);

    const snapshots = session.events.filter(event => event instanceof OverworldSnapshotEvent);
    assert.equal(snapshots.length, 1);
    const snapshot = snapshots[0];
    assert.equal(snapshot.chunks.length, 1);
    assert.deepEqual(snapshot.runStarts, [2 * CHUNK_SIZE + 3]);
    assert.deepEqual(snapshot.runLengths, [1]);
    assert.deepEqual(snapshot.runTypeIds, [BeltDefinition.typeId]);
});

test("an overworld snapshot carries the rect's claims, owner names pushed first", async () => {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry));
    await game.init();

    const alice = new CapturingSession(1);
    const bob = new CapturingSession(2);
    game.connect(alice);
    game.connect(bob);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(3, 2)), alice);
    bob.events.length = 0;

    game.dispatchMessage(new OverworldRequestMessage(-1, -1, 2, 2), bob);
    const nameIndex = bob.events.findIndex(
        event => event instanceof PlayerNamesEvent && event.playerIds.includes(1),
    );
    const snapshotIndex = bob.events.findIndex(event => event instanceof OverworldSnapshotEvent);
    assert.ok(nameIndex >= 0, "the requester learns the owner's name");
    assert.ok(snapshotIndex > nameIndex, "the name precedes the snapshot");
    const snapshot = bob.events[snapshotIndex];
    assert.deepEqual(snapshot.claimedChunks, [chunkId(3, 2)]);
    assert.deepEqual(snapshot.claimOwners, [1]);

    // A repeat request resends no known name; a rect missing the claim carries none.
    bob.events.length = 0;
    game.dispatchMessage(new OverworldRequestMessage(5, 5, 2, 2), bob);
    assert.ok(!bob.events.some(event => event instanceof PlayerNamesEvent));
    const far = bob.events.filter(event => event instanceof OverworldSnapshotEvent).at(-1);
    assert.deepEqual(far.claimedChunks, []);
});

test("an over-area overworld request fails validation and gets no snapshot", async () => {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry));
    await game.init();
    const api = new GameAPI(game);

    const session = new CapturingSession();
    game.connect(session);

    api.sendMessage(new OverworldRequestMessage(0, 0, REGION_SIZE, REGION_SIZE + 1), session);

    const snapshots = session.events.filter(event => event instanceof OverworldSnapshotEvent);
    assert.equal(snapshots.length, 0);
});
