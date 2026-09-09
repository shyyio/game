import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent, ObjectFieldsEvent} from "@/common/ObjectEvents.js";
import {WaterResourceType, ExtractorType} from "@/mods/base-game/common/objectTypes.js";
import {ITEM_TYPE_WATER} from "@/mods/base-game/common/constants.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {EventCollector} from "@/test/EventCollector.js";

async function setup() {
    return makeGameEngine();
}

test("an extractor on water produces the water item into its output port", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.objectTypeId, 5, 5, Direction.UP));
    assert.equal(engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 5, 5, Direction.UP)), true);
    assert.equal(engine.placed.eidsOf(ExtractorType.objectTypeId).length, 1, "extractor placed on the resource");

    // The product is fixed by the resource, so the spawn tick's field delta already carries it.
    engine.tickAll();
    const events = collector.drain();
    const insert = events.find(event => event instanceof ObjectInsertEvent && event.objectTypeId === ExtractorType.objectTypeId);
    assert.equal(insert.lastOutput, undefined, "the insert carries no output slot");
    const fields = events.find(event => event instanceof ObjectFieldsEvent && event.objectRef === insert.objectRef);
    assert.deepEqual(fields.values, [ITEM_TYPE_WATER], "lastOutput seeded at placement");

    const outPort = engine.ports.at(5, 4, Direction.UP);
    let produced = false;
    for (let i = 0; i < 8 && !produced; i += 1) {
        engine.tickAll();
        produced = engine.ports.item(outPort) === ITEM_TYPE_WATER;
    }
    assert.ok(produced, "the extractor produced a water item");
});

test("an extractor cannot be placed off a resource", async () => {
    const engine = await setup();
    engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 10, 10, Direction.UP));
    assert.equal(engine.placed.eidsOf(ExtractorType.objectTypeId).length, 0, "no extractor placed without a resource");
});

test("resource and extractor delete", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.objectTypeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 5, 5, Direction.UP));
    const inserts = collector.drain().filter(e => e instanceof ObjectInsertEvent);
    const resourceId = inserts.find(e => e.objectTypeId === WaterResourceType.objectTypeId).objectRef;
    const extractorId = inserts.find(e => e.objectTypeId === ExtractorType.objectTypeId).objectRef;

    assert.equal(engine.applyMessage(new DeleteObjectMessage(extractorId)), true);
    assert.equal(engine.placed.eidsOf(ExtractorType.objectTypeId).length, 0);
    assert.equal(engine.applyMessage(new DeleteObjectMessage(resourceId)), true);
    assert.equal(engine.space.userDataAt(5, 5, "R"), null, "resource cover cleared");
});
