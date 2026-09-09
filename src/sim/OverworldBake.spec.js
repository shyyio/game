import {test} from "node:test";
import assert from "node:assert/strict";

import {CHUNK_SIZE, Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {BeltDefinition, BeltTunnelDownDefinition, BeltTunnelUpDefinition, HousingDefinition} from "@/mods/logistics/common/objectTypes.js";
import {WaterResourceType, ExtractorType} from "@/mods/base-game/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";

/**
 * One chunk's runs from a snapshot event, as {start, length, objectTypeId} records.
 */
function runsFor(event, chunkKey) {
    let offset = 0;
    for (let i = 0; i < event.chunks.length; i += 1) {
        const count = event.runCounts[i];
        if (event.chunks[i] === chunkKey) {
            const runs = [];
            for (let run = offset; run < offset + count; run += 1) {
                runs.push({
                    start: event.runStarts[run],
                    length: event.runLengths[run],
                    objectTypeId: event.runTypeIds[run],
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
    engine.applyMessage(new CreateObjectMessage(BeltDefinition.objectTypeId, 3, 2, Direction.UP));

    const event = engine.overworldBake.snapshot(0, 0, 1, 1);
    assert.equal(event.chunks.length, 1);
    assert.deepEqual(runsFor(event, event.chunks[0]), [
        {start: 2 * CHUNK_SIZE + 3, length: 1, objectTypeId: BeltDefinition.objectTypeId},
    ]);
});

test("a 2x2 housing bakes as one run per covered row", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(HousingDefinition.objectTypeId, 10, 10, Direction.UP));

    const event = engine.overworldBake.snapshot(0, 0, 1, 1);
    assert.deepEqual(runsFor(event, event.chunks[0]), [
        {start: 10 * CHUNK_SIZE + 10, length: 2, objectTypeId: HousingDefinition.objectTypeId},
        {start: 11 * CHUNK_SIZE + 10, length: 2, objectTypeId: HousingDefinition.objectTypeId},
    ]);
});

test("a deleted object's chunk drops out of the snapshot", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BeltDefinition.objectTypeId, 3, 2, Direction.UP));
    const objectRef = engine.placed.objectRefOf(engine.placed.eidsOf(BeltDefinition.objectTypeId)[0]);
    engine.applyMessage(new DeleteObjectMessage(objectRef));

    const event = engine.overworldBake.snapshot(0, 0, 1, 1);
    assert.equal(event.chunks.length, 0);
});

test("undergrounds stay out of the bake; mouths stay in", async () => {
    const engine = await makeGameEngine();
    // Tunnel-down at (0,4), tunnel-up at (0,1) auto-fills undergrounds at (0,3) and (0,2).
    engine.applyMessage(new CreateObjectMessage(BeltTunnelDownDefinition.objectTypeId, 0, 4, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(BeltTunnelUpDefinition.objectTypeId, 0, 1, Direction.UP));

    const event = engine.overworldBake.snapshot(0, 0, 1, 1);
    assert.deepEqual(runsFor(event, event.chunks[0]), [
        {start: 1 * CHUNK_SIZE, length: 1, objectTypeId: BeltTunnelUpDefinition.objectTypeId},
        {start: 4 * CHUNK_SIZE, length: 1, objectTypeId: BeltTunnelDownDefinition.objectTypeId},
    ]);
});

test("an extractor on a water tile wins the tile's bake", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.objectTypeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 5, 5, Direction.UP));

    const event = engine.overworldBake.snapshot(0, 0, 1, 1);
    assert.deepEqual(runsFor(event, event.chunks[0]), [
        {start: 5 * CHUNK_SIZE + 5, length: 1, objectTypeId: ExtractorType.objectTypeId},
    ]);
});

test("the bake survives a serialize/deserialize round-trip", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BeltDefinition.objectTypeId, 3, 2, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(HousingDefinition.objectTypeId, -70, -70, Direction.UP));
    const before = engine.overworldBake.snapshot(-2, -2, 4, 4);

    const restored = await makeGameEngine();
    restored.snapshots.deserialize(engine.snapshots.serialize());
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
