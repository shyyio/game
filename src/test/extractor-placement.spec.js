import {test} from "node:test";
import assert from "node:assert/strict";
import {ModRegistry} from "@/common/ModRegistry.js";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {EasyObjectInsertEvent} from "@/common/EasyObjectEvents.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";
import {DemoMod} from "@/mods/DemoMod/DemoMod.js";
import {ResourcesMod, WaterResourceDefinition, ExtractorDefinition, WATER_ITEM_TYPE} from "@/mods/Resources/Resources.js";
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";
import {makeEcsSimEngine} from "@/test/ecsSim.js";

async function setup() {
    const mr = new ModRegistry();
    mr.loadMod(new LogisticsMod());
    mr.loadMod(new DemoMod());
    mr.loadMod(new ResourcesMod());
    mr.definitions;
    const engine = await makeEcsSimEngine();
    return engine;
}

test("an extractor on water produces the water item into its output port", async () => {
    const engine = await setup();
    engine.applyMessage(new CreateObjectMessage(WaterResourceDefinition.typeId, 5, 5, Direction.UP));
    assert.equal(engine.applyMessage(new CreateObjectMessage(ExtractorDefinition.typeId, 5, 5, Direction.UP)), true);
    assert.equal(engine.extractor.eids().length, 1, "extractor placed on the resource");

    const outPort = engine.engine.portAt(5, 4, Direction.UP);
    let produced = false;
    for (let i = 0; i < 8 && !produced; i += 1) {
        engine.tickAll();
        produced = engine.engine.portItem(outPort) === WATER_ITEM_TYPE;
    }
    assert.ok(produced, "the extractor produced a water item");
});

test("an extractor cannot be placed off a resource", async () => {
    const engine = await setup();
    engine.applyMessage(new CreateObjectMessage(ExtractorDefinition.typeId, 10, 10, Direction.UP));
    assert.equal(engine.extractor.eids().length, 0, "no extractor placed without a resource");
});

test("resource and extractor delete", async () => {
    const engine = await setup();
    engine.applyMessage(new CreateObjectMessage(WaterResourceDefinition.typeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorDefinition.typeId, 5, 5, Direction.UP));
    const inserts = engine.drainEvents().filter(e => e instanceof EasyObjectInsertEvent);
    const resourceId = inserts.find(e => e.typeId === WaterResourceDefinition.typeId).id;
    const extractorId = inserts.find(e => e.typeId === ExtractorDefinition.typeId).id;

    assert.equal(engine.applyMessage(new DeleteObjectMessage(extractorId)), true);
    assert.equal(engine.extractor.eids().length, 0);
    assert.equal(engine.applyMessage(new DeleteObjectMessage(resourceId)), true);
    assert.equal(engine.resources.coverAt(5, 5), null, "resource cover cleared");
});
