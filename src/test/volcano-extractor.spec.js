import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {VolcanoResourceType, ExtractorType, DeepExtractorType, ITEM_TYPE_SULFUR, ITEM_TYPE_BRINE} from "@/mods/Resources/declaration.js";
import {makeGameEngine} from "@/test/ecsSim.js";

test("a volcano feeds a primary extractor (sulfur) and a deep extractor (brine) on its ring", async () => {
    const engine = await makeGameEngine();

    // Volcano 2x2 at (5,5); (5,4) and (6,4) are ring extraction tiles (offset {0,-1},{1,-1}).
    engine.applyMessage(new CreateObjectMessage(VolcanoResourceType.typeId, 5, 5, Direction.UP));
    assert.equal(engine.occupantUserDataAt(5, 4, "R"), 201, "ring tile is covered by volcano");
    assert.equal(engine.occupantUserDataAt(5, 5, "R"), null, "the 2x2 body is not an extraction tile");

    engine.applyMessage(new CreateObjectMessage(ExtractorType.typeId, 5, 4, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(DeepExtractorType.typeId, 6, 4, Direction.UP));
    assert.equal(engine.placed.eidsOf(ExtractorType.typeId).length, 1);
    assert.equal(engine.placed.eidsOf(DeepExtractorType.typeId).length, 1);

    const sulfurOut = engine.portAt(5, 3, Direction.UP);
    const brineOut = engine.portAt(6, 3, Direction.UP);
    let sulfur = false;
    let brine = false;
    for (let i = 0; i < 12; i += 1) {
        engine.tickAll();
        if (engine.portItem(sulfurOut) === ITEM_TYPE_SULFUR) sulfur = true;
        if (engine.portItem(brineOut) === ITEM_TYPE_BRINE) brine = true;
    }
    assert.ok(sulfur, "primary extractor produced sulfur");
    assert.ok(brine, "deep extractor produced brine");
});
