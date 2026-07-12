import {test} from "node:test";
import assert from "node:assert/strict";
import {ModRegistry} from "@/common/ModRegistry.js";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {EasyObjectInsertEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";
import {SplitterDefinition} from "@/mods/Logistics/definitions.js";
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";
import {makeEcsSimEngine} from "@/test/ecsSim.js";

test("placing a splitter via CreateObjectMessage emits an EasyObjectInsertEvent; delete emits a delete", async () => {
    // Accessing definitions assigns each a typeId (as DatabaseSchema does in the real app).
    const modRegistry = new ModRegistry();
    modRegistry.loadMod(new LogisticsMod());
    modRegistry.definitions;

    const engine = await makeEcsSimEngine();

    const handled = engine.applyMessage(new CreateObjectMessage(SplitterDefinition.typeId, 5, 5, Direction.UP));
    assert.equal(handled, true, "splitter create handled by the engine");

    const insert = engine.drainEvents().find(event => event instanceof EasyObjectInsertEvent);
    assert.ok(insert, "EasyObjectInsertEvent emitted");
    assert.equal(insert.typeId, SplitterDefinition.typeId);
    assert.equal(insert.x, 5);
    assert.equal(insert.y, 5);
    assert.equal(insert.portIds.length, 2, "out_a and out_b port ids sent");

    // Chunk sync recreates it.
    const sync = engine.chunkSync(insert.chunk);
    assert.ok(sync.some(event => event.id === insert.id), "splitter appears in chunk sync");

    // Delete removes it and emits a delete event.
    assert.equal(engine.applyMessage(new DeleteObjectMessage(insert.id)), true, "splitter delete handled");
    assert.ok(engine.drainEvents().some(event => event instanceof EasyObjectDeleteEvent && event.id === insert.id), "EasyObjectDeleteEvent emitted");
});
