import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent} from "@/common/ObjectEvents.js";
import {WaterResourceType, ExtractorType, ITEM_TYPE_WATER} from "@/mods/Resources/declaration.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {EventCollector} from "@/test/EventCollector.js";

async function setup() {
    return makeGameEngine();
}

test("an extractor on water produces the water item into its output port", async () => {
    const engine = await setup();
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.typeId, 5, 5, Direction.UP));
    assert.equal(engine.applyMessage(new CreateObjectMessage(ExtractorType.typeId, 5, 5, Direction.UP)), true);
    assert.equal(engine.placed.eidsOf(ExtractorType.typeId).length, 1, "extractor placed on the resource");

    const outPort = engine.portAt(5, 4, Direction.UP);
    let produced = false;
    for (let i = 0; i < 8 && !produced; i += 1) {
        engine.tickAll();
        produced = engine.portItem(outPort) === ITEM_TYPE_WATER;
    }
    assert.ok(produced, "the extractor produced a water item");
});

test("an extractor cannot be placed off a resource", async () => {
    const engine = await setup();
    engine.applyMessage(new CreateObjectMessage(ExtractorType.typeId, 10, 10, Direction.UP));
    assert.equal(engine.placed.eidsOf(ExtractorType.typeId).length, 0, "no extractor placed without a resource");
});

test("resource and extractor delete", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.typeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.typeId, 5, 5, Direction.UP));
    const inserts = collector.drain().filter(e => e instanceof ObjectInsertEvent);
    const resourceId = inserts.find(e => e.typeId === WaterResourceType.typeId).id;
    const extractorId = inserts.find(e => e.typeId === ExtractorType.typeId).id;

    assert.equal(engine.applyMessage(new DeleteObjectMessage(extractorId)), true);
    assert.equal(engine.placed.eidsOf(ExtractorType.typeId).length, 0);
    assert.equal(engine.applyMessage(new DeleteObjectMessage(resourceId)), true);
    assert.equal(engine.occupantValueAt(5, 5, "R"), null, "resource cover cleared");
});
