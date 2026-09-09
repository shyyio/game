import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {Direction} from "@/common/constants.js";
import {chunkKeyAt} from "@/common/util.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage, SetChunkPermissionMessage} from "@/common/ClaimMessages.js";
import {AddFriendMessage} from "@/common/PlayerMessages.js";
import {ChunkPermission} from "@/common/ClaimEvents.js";
import {BlenderType} from "@/mods/base-game/common/objectTypes.js";
import {PipeDefinition} from "@/mods/fluids/common/objectTypes.js";
import {ITEM_TYPE_CABBAGE} from "@/mods/base-game/common/constants.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";

const ALICE = 1;
const BOB = 2;

/**
 * Alice's chunk, open to her friend Bob: the case where the placer and the ground's owner differ.
 * @returns {Promise<{game: Game, alice: CapturingSession, bob: CapturingSession, chunk: number}>}
 */
async function setup() {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry));
    await game.init();
    const alice = new CapturingSession(ALICE);
    const bob = new CapturingSession(BOB);
    game.connect(alice);
    game.connect(bob);
    const chunkKey = chunkKeyAt(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunkKey), alice);
    game.dispatchMessage(new AddFriendMessage(BOB), alice);
    game.dispatchMessage(new SetChunkPermissionMessage(chunkKey, ChunkPermission.PERMISSION_FRIENDS), alice);
    return {game, alice, bob, chunkKey};
}

test("a placed object records who placed it, not whose chunk it landed in", async () => {
    const {game, bob} = await setup();
    game.dispatchMessage(new CreateObjectMessage(BlenderType.objectTypeId, 5, 5, Direction.UP), bob);

    const [eid] = game.simEngine.placed.eidsOf(BlenderType.objectTypeId);
    assert.equal(game.simEngine.placed.placedByOf(eid), BOB);
});

test("an object's claim owner is the ground's current owner, not a placement-time snapshot", async () => {
    const {game, bob} = await setup();
    game.dispatchMessage(new CreateObjectMessage(BlenderType.objectTypeId, 5, 5, Direction.UP), bob);

    const [eid] = game.simEngine.placed.eidsOf(BlenderType.objectTypeId);
    assert.equal(game.simEngine.placed.claimOwnerOf(eid), ALICE);
});

test("production is credited to the chunk owner, not to the friend who built the machine", async () => {
    const {game, bob} = await setup();
    const produced = [];
    game.simEngine.itemProduced.add((playerRef, itemTypeId, amount) => produced.push(playerRef));
    game.dispatchMessage(new CreateObjectMessage(BlenderType.objectTypeId, 5, 5, Direction.UP), bob);
    game.dispatchMessage(new CreateObjectMessage(PipeDefinition.objectTypeId, 5, 4, Direction.UP), bob);

    const engine = game.simEngine;
    const [eid] = engine.placed.eidsOf(BlenderType.objectTypeId);
    const def = engine.components.get("Machine");
    const row = def.row(eid);
    for (let i = 0; i < 10; i += 1) {
        engine.ports.setItem(def.store.in0[row], ITEM_TYPE_CABBAGE);
        engine.tickAll();
    }

    assert.ok(produced.length > 0, "the machine produced nothing to attribute");
    assert.deepEqual([...new Set(produced)], [ALICE]);
});
