import {test} from "node:test";
import assert from "node:assert/strict";

import {Game} from "@/sim/Game.js";
import {GameAPI} from "@/sim/GameAPI.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {CHUNK_SIZE, REGION_SIZE, Direction} from "@/common/constants.js";
import {CreateObjectMessage, OverworldRequestMessage} from "@/common/CoreMessages.js";
import {OverworldSnapshotEvent} from "@/common/OverworldEvents.js";
import {BeltDefinition} from "@/mods/Logistics/common/objectTypes.js";
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
