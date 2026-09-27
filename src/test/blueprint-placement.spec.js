import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, LAYER_SURFACE, CHUNK_SIZE} from "@/common/constants.js";
import {chunkKeyAt} from "@/common/util.js";
import {NO_EID} from "@/sim/AbstractComponent.js";
import {Blueprint, BlueprintEntry} from "@/common/Blueprint.js";
import {PlaceBlueprintMessage} from "@/common/CoreMessages.js";
import {getLaneLevelLayer, LANE_LEVEL_ELEVATED_1} from "@/sim/LaneIndex.js";
import {BeltType, BeltRampUp1Type, BeltElevated1Type} from "@/mods/logistics/common/objectTypes.js";
import {CoalDepositResourceType} from "@/mods/base-game/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {placeBelt} from "@/test/beltFixture.js";

const PLAYER = 1;

/**
 * @param {GameEngine} engine
 * @param {number} tileX
 * @param {number} tileY
 * @returns {Direction|null}
 */
function surfaceBeltDirectionAt(engine, tileX, tileY) {
    const eid = engine.placed.getEidAt(tileX, tileY, LAYER_SURFACE);
    if (eid === NO_EID) {
        return null;
    }
    return engine.Position.direction[eid];
}

test("a blueprint lands every entry at its offset from the anchor", async () => {
    const engine = await makeGameEngine();
    const blueprint = new Blueprint([
        new BlueprintEntry(BeltType.objectTypeId, 0, 0, Direction.UP),
        new BlueprintEntry(BeltType.objectTypeId, 0, -1, Direction.RIGHT),
    ]);

    engine.applyMessage(new PlaceBlueprintMessage(10, 10, blueprint), PLAYER);

    assert.equal(surfaceBeltDirectionAt(engine, 10, 10), Direction.UP);
    assert.equal(surfaceBeltDirectionAt(engine, 10, 9), Direction.RIGHT);
});

test("an entry on an occupied cell is skipped while the rest land", async () => {
    const engine = await makeGameEngine();
    placeBelt(engine, 10, 9, Direction.DOWN);
    const blueprint = new Blueprint([
        new BlueprintEntry(BeltType.objectTypeId, 0, 0, Direction.UP),
        new BlueprintEntry(BeltType.objectTypeId, 0, -1, Direction.UP),
    ]);

    engine.applyMessage(new PlaceBlueprintMessage(10, 10, blueprint), PLAYER);

    assert.equal(surfaceBeltDirectionAt(engine, 10, 10), Direction.UP);
    assert.equal(surfaceBeltDirectionAt(engine, 10, 9), Direction.DOWN, "the standing belt is untouched");
});

test("an elevated belt lands whatever its place in the entry order", async () => {
    const engine = await makeGameEngine();
    const blueprint = new Blueprint([
        new BlueprintEntry(BeltElevated1Type.objectTypeId, 0, -1, Direction.UP),
        new BlueprintEntry(BeltRampUp1Type.objectTypeId, 0, 0, Direction.UP),
    ]);

    engine.applyMessage(new PlaceBlueprintMessage(0, 4, blueprint), PLAYER);

    const elevated = getLaneLevelLayer(LANE_LEVEL_ELEVATED_1, Direction.UP);
    assert.notEqual(engine.placed.getEidAt(0, 3, elevated), NO_EID, "the elevated cell stands");
});

test("an entry in a chunk the player cannot build in is skipped", async () => {
    const engine = await makeGameEngine();
    engine.chunkOwners = {canBuildIn: (playerRef, chunkKey) => chunkKey === chunkKeyAt(10, 10)};
    const blueprint = new Blueprint([
        new BlueprintEntry(BeltType.objectTypeId, 0, 0, Direction.UP),
        new BlueprintEntry(BeltType.objectTypeId, CHUNK_SIZE, 0, Direction.UP),
    ]);

    engine.applyMessage(new PlaceBlueprintMessage(10, 10, blueprint), PLAYER);

    assert.equal(surfaceBeltDirectionAt(engine, 10, 10), Direction.UP);
    assert.equal(surfaceBeltDirectionAt(engine, 10 + CHUNK_SIZE, 10), null);
});

test("a non-solid entry lands once when a later pass places the rest", async () => {
    const engine = await makeGameEngine();
    const blueprint = new Blueprint([
        new BlueprintEntry(CoalDepositResourceType.objectTypeId, 1, 0, Direction.UP),
        new BlueprintEntry(BeltElevated1Type.objectTypeId, 0, -1, Direction.UP),
        new BlueprintEntry(BeltRampUp1Type.objectTypeId, 0, 0, Direction.UP),
    ]);

    engine.applyMessage(new PlaceBlueprintMessage(0, 4, blueprint), PLAYER);

    assert.equal(engine.placed.getEidsByTypeId(CoalDepositResourceType.objectTypeId).length, 1);
});
