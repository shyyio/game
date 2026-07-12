import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {EcsEngine} from "@/common/sim/EcsEngine.js";
import {BeltModule} from "@/mods/Logistics/BeltModule.js";
import {BufferedEvent} from "@/common/BufferedEvent.js";
import {BUFFERED_EVENT_TYPE_PORT_ITEM_SET} from "@/common/constants.js";

const RED = 1;

// A belt's out-port (drawn at the tail tile) emits a PORT_ITEM_SET when a popped item rests there.
test("a belt emits a PORT_ITEM set when an item pops to its out-port", async () => {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);
    let handle = null;
    [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}].forEach(cell => {
        handle = belts.placeBelt(cell.x, cell.y, Direction.UP);
    });
    engine.drainEvents(); // discard placement events

    engine.setPortItem(handle.inPort, RED);
    const sets = [];
    for (let i = 0; i < 8; i += 1) {
        engine.tickAll();
        engine.drainEvents().forEach(event => {
            if (event instanceof BufferedEvent && event.type === BUFFERED_EVENT_TYPE_PORT_ITEM_SET) {
                sets.push(event);
            }
        });
    }

    assert.equal(sets.length, 1);
    assert.equal(sets[0].id, BigInt(handle.outPort));
    assert.equal(sets[0].a, RED);
});
