import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {NO_EID} from "@/sim/AbstractComponent.js";
import {Blueprint, BlueprintEntry} from "@/common/Blueprint.js";
import {DeleteBlueprintMessage} from "@/common/CoreMessages.js";
import {BeltType, BeltRampUp1Type} from "@/mods/logistics/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {placeBelt} from "@/test/beltFixture.js";

const PLAYER = 1;

test("a blueprint delete removes the object of each entry's type at its tile", async () => {
    const engine = await makeGameEngine();
    placeBelt(engine, 10, 10, Direction.UP);

    engine.applyMessage(new DeleteBlueprintMessage(new Blueprint([new BlueprintEntry(BeltType.objectTypeId, 10, 10, Direction.UP)])), PLAYER);

    assert.equal(engine.placed.getEidAt(10, 10, LAYER_SURFACE), NO_EID);
});

test("a blueprint delete leaves an object of another type standing", async () => {
    const engine = await makeGameEngine();
    placeBelt(engine, 10, 10, Direction.UP);

    engine.applyMessage(new DeleteBlueprintMessage(new Blueprint([new BlueprintEntry(BeltRampUp1Type.objectTypeId, 10, 10, Direction.UP)])), PLAYER);

    assert.notEqual(engine.placed.getEidAt(10, 10, LAYER_SURFACE), NO_EID);
});
