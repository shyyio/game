import {test} from "node:test";
import assert from "node:assert/strict";
import {ModRegistry} from "@/common/ModRegistry.js";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";
import {DemoMod} from "@/mods/DemoMod/DemoMod.js";
import {ResourcesMod, VolcanoResourceDefinition, ExtractorDefinition, DeepExtractorDefinition, SULFUR_ITEM_TYPE, BRINE_ITEM_TYPE} from "@/mods/Resources/Resources.js";
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";
import {makeEcsSimEngine} from "@/test/ecsSim.js";

test("a volcano feeds a primary extractor (sulfur) and a deep extractor (brine) on its ring", async () => {
    const mr = new ModRegistry();
    mr.loadMod(new LogisticsMod());
    mr.loadMod(new DemoMod());
    mr.loadMod(new ResourcesMod());
    mr.definitions;
    const engine = await makeEcsSimEngine();

    // Volcano 2x2 at (5,5); (5,4) and (6,4) are ring extraction tiles (offset {0,-1},{1,-1}).
    engine.applyMessage(new CreateObjectMessage(VolcanoResourceDefinition.typeId, 5, 5, Direction.UP));
    assert.equal(engine.resources.coverAt(5, 4), 201, "ring tile is covered by volcano");
    assert.equal(engine.resources.coverAt(5, 5), null, "the 2x2 body is not an extraction tile");

    engine.applyMessage(new CreateObjectMessage(ExtractorDefinition.typeId, 5, 4, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(DeepExtractorDefinition.typeId, 6, 4, Direction.UP));
    assert.equal(engine.extractor.ids.length, 1);
    assert.equal(engine.deepExtractor.ids.length, 1);

    const sulfurOut = engine.engine.portAt(5, 3, Direction.UP);
    const brineOut = engine.engine.portAt(6, 3, Direction.UP);
    let sulfur = false;
    let brine = false;
    for (let i = 0; i < 12; i += 1) {
        engine.tickAll();
        if (engine.engine.portItem(sulfurOut) === SULFUR_ITEM_TYPE) sulfur = true;
        if (engine.engine.portItem(brineOut) === BRINE_ITEM_TYPE) brine = true;
    }
    assert.ok(sulfur, "primary extractor produced sulfur");
    assert.ok(brine, "deep extractor produced brine");
});
