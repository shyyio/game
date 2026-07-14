import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {GameEngine} from "@/common/sim/GameEngine.js";
import {BeltModule} from "@/mods/Logistics/BeltModule.js";
import {
    BeltItemUpsertEvent,
    BeltItemDeleteEvent,
} from "@/mods/Logistics/events.js";

const RED = 1;

// A moving belt item emits a BeltItemUpsertEvent (ingest) and BeltItemDeleteEvent (pop) keyed by
// path id + run id, so the client renders and glides items along the belt body.
test("a belt item emits an upsert on ingest and a delete on pop", async () => {
    const engine = new GameEngine();
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
            if (event instanceof BeltItemUpsertEvent || event instanceof BeltItemDeleteEvent) {
                items.push(event);
            }
        });
    }

    const upserts = items.filter(event => event instanceof BeltItemUpsertEvent);
    const deletes = items.filter(event => event instanceof BeltItemDeleteEvent);

    // The item run (type RED) is upserted, and every item event is keyed to the head belt's path id (3).
    assert.ok(upserts.some(event => event.itemType === RED), "the item run is upserted");
    assert.ok(deletes.length > 0, "runs are deleted as the item advances/pops");
    assert.ok(items.every(event => event.pathId === 3), "all item events carry the head belt path id");
});
