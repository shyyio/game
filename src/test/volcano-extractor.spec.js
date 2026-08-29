import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {ModPackage} from "@/common/ModPackage.js";
import {
    TestVolcanoResourceType,
    TestExtractorType,
    TestDeepExtractorType,
    ITEM_TYPE_TEST_SULFUR,
    ITEM_TYPE_TEST_BRINE,
    VolcanoFixtureDeclaration,
} from "@/test/volcanoFixture.js";
import {makeGameEngine} from "@/test/ecsSim.js";

test("a volcano feeds a primary extractor (sulfur) and a deep extractor (brine) on its ring", async () => {
    const engine = await makeGameEngine([new ModPackage(new VolcanoFixtureDeclaration())]);

    // Volcano 2x2 at (5,5); (5,4) and (6,4) are ring extraction tiles (offset {0,-1},{1,-1}).
    // Sent facing RIGHT: a non-directional type spawns facing UP, so cover and body never rotate apart.
    engine.applyMessage(new CreateObjectMessage(TestVolcanoResourceType.typeId, 5, 5, Direction.RIGHT));
    assert.equal(engine.occupantUserDataAt(5, 4, "R"), 900, "ring tile is covered by volcano");
    assert.equal(engine.occupantUserDataAt(5, 5, "R"), null, "the 2x2 body is not an extraction tile");

    engine.applyMessage(new CreateObjectMessage(TestExtractorType.typeId, 5, 4, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(TestDeepExtractorType.typeId, 6, 4, Direction.UP));
    assert.equal(engine.placed.eidsOf(TestExtractorType.typeId).length, 1);
    assert.equal(engine.placed.eidsOf(TestDeepExtractorType.typeId).length, 1);

    const sulfurOut = engine.portAt(5, 3, Direction.UP);
    const brineOut = engine.portAt(6, 3, Direction.UP);
    let sulfur = false;
    let brine = false;
    for (let i = 0; i < 12; i += 1) {
        engine.tickAll();
        if (engine.portItem(sulfurOut) === ITEM_TYPE_TEST_SULFUR) {
            sulfur = true;
        }
        if (engine.portItem(brineOut) === ITEM_TYPE_TEST_BRINE) {
            brine = true;
        }
    }
    assert.ok(sulfur, "primary extractor produced sulfur");
    assert.ok(brine, "deep extractor produced brine");
});
