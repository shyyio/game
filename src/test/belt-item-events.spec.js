import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {EcsEngine} from "@/common/sim/EcsEngine.js";
import {BeltModule} from "@/mods/Logistics/BeltModule.js";
import {BufferedEvent} from "@/common/BufferedEvent.js";
import {
    BUFFERED_EVENT_TYPE_ITEM_UPSERT,
    BUFFERED_EVENT_TYPE_ITEM_DELETE,
} from "@/mods/Logistics/constants.js";

const RED = 1;
const ITEM_TYPES = new Set([BUFFERED_EVENT_TYPE_ITEM_UPSERT, BUFFERED_EVENT_TYPE_ITEM_DELETE]);

// A moving belt item emits ITEM_UPSERT (ingest) and ITEM_DELETE (pop) keyed by path id + run id, so
// the client renders and glides items along the belt body.
test("a belt item emits ITEM_UPSERT on ingest and ITEM_DELETE on pop", async () => {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);
    let handle = null;
    [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}].forEach(cell => {
        handle = belts.placeBelt(cell.x, cell.y, Direction.UP);
    });
    engine.drainEvents(); // discard placement events

    engine.setPortItem(handle.inPort, RED);
    const items = [];
    for (let i = 0; i < 8; i += 1) {
        engine.tickAll();
        engine.drainEvents().forEach(event => {
            if (event instanceof BufferedEvent && ITEM_TYPES.has(event.type)) {
                items.push(event);
            }
        });
    }

    const upserts = items.filter(event => event.type === BUFFERED_EVENT_TYPE_ITEM_UPSERT);
    const deletes = items.filter(event => event.type === BUFFERED_EVENT_TYPE_ITEM_DELETE);

    // The item run (type RED) is upserted, and every item event is keyed to the head belt's path id (3).
    assert.ok(upserts.some(event => event.c === RED), "the item run is upserted");
    assert.ok(deletes.length > 0, "runs are deleted as the item advances/pops");
    assert.ok(items.every(event => event.id === 3n), "all item events carry the head belt path id");
});
