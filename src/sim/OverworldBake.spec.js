import {test} from "node:test";
import assert from "node:assert/strict";

import {CHUNK_SIZE, Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {BeltDefinition, BeltRampDownDefinition, BeltRampUpDefinition, HousingDefinition} from "@/mods/Logistics/common/objectTypes.js";
import {WaterResourceType, ExtractorType} from "@/mods/BaseGame/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";

/**
 * One chunk's runs from a snapshot event, as {start, length, typeId} records.
 */
function runsFor(event, chunk) {
    let offset = 0;
    for (let i = 0; i < event.chunks.length; i += 1) {
        const count = event.runCounts[i];
        if (event.chunks[i] === chunk) {
            const runs = [];
            for (let run = offset; run < offset + count; run += 1) {
                runs.push({
                    start: event.runStarts[run],
                    length: event.runLengths[run],
                    typeId: event.runTypeIds[run],
                });
            }
            return runs;
        }
        offset += count;
    }
    return [];
}

test("a placed belt bakes as one run at its tile", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, 3, 2, Direction.UP));

    const event = engine.overworldBake.snapshot(0, 0, 1, 1);
    assert.equal(event.chunks.length, 1);
    assert.deepEqual(runsFor(event, event.chunks[0]), [
        {start: 2 * CHUNK_SIZE + 3, length: 1, typeId: BeltDefinition.typeId},
    ]);
});

test("a 2x2 housing bakes as one run per covered row", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(HousingDefinition.typeId, 10, 10, Direction.UP));

    const event = engine.overworldBake.snapshot(0, 0, 1, 1);
    assert.deepEqual(runsFor(event, event.chunks[0]), [
        {start: 10 * CHUNK_SIZE + 10, length: 2, typeId: HousingDefinition.typeId},
        {start: 11 * CHUNK_SIZE + 10, length: 2, typeId: HousingDefinition.typeId},
    ]);
});

test("a deleted object's chunk drops out of the snapshot", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, 3, 2, Direction.UP));
    const objectId = engine.placed.objectIdOf(engine.placed.eidsOf(BeltDefinition.typeId)[0]);
    engine.applyMessage(new DeleteObjectMessage(objectId));

    const event = engine.overworldBake.snapshot(0, 0, 1, 1);
    assert.equal(event.chunks.length, 0);
});

test("undergrounds stay out of the bake; ramps stay in", async () => {
    const engine = await makeGameEngine();
    // Ramp-down at (0,4), ramp-up at (0,1) auto-fills undergrounds at (0,3) and (0,2).
    engine.applyMessage(new CreateObjectMessage(BeltRampDownDefinition.typeId, 0, 4, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(BeltRampUpDefinition.typeId, 0, 1, Direction.UP));

    const event = engine.overworldBake.snapshot(0, 0, 1, 1);
    assert.deepEqual(runsFor(event, event.chunks[0]), [
        {start: 1 * CHUNK_SIZE, length: 1, typeId: BeltRampUpDefinition.typeId},
        {start: 4 * CHUNK_SIZE, length: 1, typeId: BeltRampDownDefinition.typeId},
    ]);
});

test("an extractor on a water tile wins the tile's bake", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.typeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.typeId, 5, 5, Direction.UP));

    const event = engine.overworldBake.snapshot(0, 0, 1, 1);
    assert.deepEqual(runsFor(event, event.chunks[0]), [
        {start: 5 * CHUNK_SIZE + 5, length: 1, typeId: ExtractorType.typeId},
    ]);
});

test("the bake survives a serialize/deserialize round-trip", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, 3, 2, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(HousingDefinition.typeId, -70, -70, Direction.UP));
    const before = engine.overworldBake.snapshot(-2, -2, 4, 4);

    const restored = await makeGameEngine();
    restored.deserialize(engine.serialize());
    const after = restored.overworldBake.snapshot(-2, -2, 4, 4);

    assert.deepEqual(after.chunks, before.chunks);
    assert.deepEqual(after.runCounts, before.runCounts);
    assert.deepEqual(after.runStarts, before.runStarts);
    assert.deepEqual(after.runLengths, before.runLengths);
    assert.deepEqual(after.runTypeIds, before.runTypeIds);
});

test("a rect outside the region throws", async () => {
    const engine = await makeGameEngine();
    assert.throws(() => engine.overworldBake.snapshot(-100, 0, 64, 1), RangeError);
});
