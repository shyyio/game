import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent, ObjectDeleteEvent} from "@/common/ObjectEvents.js";
import {SplitterDefinition} from "@/mods/Logistics/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {EventCollector, flattenBatches} from "@/test/EventCollector.js";

test("placing a splitter via CreateObjectMessage emits an ObjectInsertEvent; delete emits a delete", async () => {
    const engine = await makeGameEngine();
    const collector = new EventCollector(engine);

    const handled = engine.applyMessage(new CreateObjectMessage(SplitterDefinition.typeId, 5, 5, Direction.UP));
    assert.equal(handled, true, "splitter create handled by the engine");

    const insert = collector.drain().find(event => event instanceof ObjectInsertEvent);
    assert.ok(insert, "ObjectInsertEvent emitted");
    assert.equal(insert.typeId, SplitterDefinition.typeId);
    assert.equal(insert.x, 5);
    assert.equal(insert.y, 5);
    assert.equal(insert.portIds.length, 2, "out_a and out_b port ids sent");

    // Chunk sync recreates it.
    const sync = flattenBatches(engine.chunkSync(insert.chunk));
    assert.ok(sync.some(event => event.id === insert.id), "splitter appears in chunk sync");

    // Delete removes it and emits a delete event.
    assert.equal(engine.applyMessage(new DeleteObjectMessage(insert.id)), true, "splitter delete handled");
    assert.ok(collector.drain().some(event => event instanceof ObjectDeleteEvent && event.id === insert.id), "ObjectDeleteEvent emitted");
});
