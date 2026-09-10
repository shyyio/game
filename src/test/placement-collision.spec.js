import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {NO_EID} from "@/sim/sentinels.js";
import {BlenderType} from "@/mods/base-game/common/objectTypes.js";
import {BeltType} from "@/mods/logistics/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {placeBelt} from "@/test/beltFixture.js";

test("a second surface belt cannot occupy the same tile, and delete frees it", async () => {
    const engine = await makeGameEngine();

    placeBelt(engine, 5, 5, Direction.UP);
    assert.equal(engine.placed.eidsOf(BeltType.objectTypeId).length, 1, "first belt placed");
    placeBelt(engine, 5, 5, Direction.RIGHT);
    assert.equal(engine.placed.eidsOf(BeltType.objectTypeId).length, 1, "second surface belt on the tile is rejected");

    const eid = engine.placed.eidAt(5, 5, LAYER_SURFACE);
    engine.applyMessage(new DeleteObjectMessage(engine.placed.objectRefOf(eid)));
    assert.equal(engine.placed.eidAt(5, 5, LAYER_SURFACE), NO_EID);
    placeBelt(engine, 5, 5, Direction.RIGHT);
    assert.equal(engine.placed.eidsOf(BeltType.objectTypeId).length, 1, "tile is free after delete");
});

test("an object cannot be placed on an occupied tile", async () => {
    const engine = await makeGameEngine();

    engine.applyMessage(new CreateObjectMessage(BlenderType.objectTypeId, 5, 5, Direction.UP));
    assert.equal(engine.placed.eidsOf(BlenderType.objectTypeId).length, 1);
    engine.applyMessage(new CreateObjectMessage(BlenderType.objectTypeId, 5, 5, Direction.UP));
    assert.equal(engine.placed.eidsOf(BlenderType.objectTypeId).length, 1, "overlapping machine rejected");
});
