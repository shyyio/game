import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, CHUNK_SIZE} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {GameEngine} from "@/common/sim/GameEngine.js";
import {EventCollector} from "@/test/EventCollector.js";
import {Belts} from "@/mods/Logistics/Belts.js";
import {
    BeltItemUpsertEvent,
    BeltItemDeleteEvent,
    BeltItemBatchEvent,
} from "@/mods/Logistics/events.js";

const RED = 1;

// A moving belt item emits a BeltItemUpsertEvent (ingest) and BeltItemDeleteEvent (pop) keyed by
// path id + run id, so the client renders and glides items along the belt body.
test("a belt item emits an upsert on ingest and a delete on pop", async () => {
    const engine = new GameEngine();
    await engine.init();
    const collector = new EventCollector(engine);
    const belts = new Belts(engine);
    let handle = null;
    for (const cell of [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}]) {
        handle = belts.placeBelt(cell.x, cell.y, Direction.UP);
    }
    collector.drain(); // discard placement events

    engine.setPortItem(handle.inPort, RED);
    const items = [];
    for (let i = 0; i < 8; i += 1) {
        engine.tickAll();
        for (const event of collector.drain()) {
            if (event instanceof BeltItemUpsertEvent || event instanceof BeltItemDeleteEvent) {
                items.push(event);
            }
        }
    }

    const upserts = items.filter(event => event instanceof BeltItemUpsertEvent);
    const deletes = items.filter(event => event instanceof BeltItemDeleteEvent);

    // The item run (type RED) is upserted, and every item event is keyed to the head belt's path id (3).
    assert.ok(upserts.some(event => event.itemType === RED), "the item run is upserted");
    assert.ok(deletes.length > 0, "runs are deleted as the item advances/pops");
    assert.ok(items.every(event => event.pathId === 3), "all item events carry the head belt path id");
});

// The move pass's deltas leave the engine as one batch per chunk, not one event per item.
test("a move pass emits one belt item batch per chunk", async () => {
    const engine = new GameEngine();
    await engine.init();
    const emitted = [];
    const belts = new Belts(engine);
    // Two paths in one chunk, a third far enough out to land in another.
    const origins = [{x: 0, y: 0}, {x: 4, y: 0}, {x: CHUNK_SIZE, y: 0}];
    const handles = origins.map(origin => {
        let handle = null;
        for (let i = 0; i < 3; i += 1) {
            handle = belts.placeBelt(origin.x, origin.y + i, Direction.UP);
        }
        return handle;
    });

    engine.setEventSink(event => emitted.push(event));
    for (const handle of handles) {
        engine.setPortItem(handle.inPort, RED);
    }
    engine.tickAll();

    const batches = emitted.filter(event => event instanceof BeltItemBatchEvent);
    assert.equal(batches.length, 2, "one batch per chunk");
    const near = batches.find(batch => batch.chunk === chunkId(0, 0));
    assert.equal(near.upsertPathIds.length, 2, "both near paths ingested into one batch");
    assert.deepEqual(near.upsertItemTypes, [RED, RED]);
});
