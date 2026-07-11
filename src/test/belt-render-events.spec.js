import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {EcsEngine} from "@/common/sim/EcsEngine.js";
import {BeltModule} from "@/common/sim/BeltSystems.js";

const RED = 1;

// A belt's out-port (drawn at the tail tile) emits a render set when a popped item rests there.
test("a belt emits a render set when an item pops to its out-port", async () => {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);
    let handle = null;
    [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}].forEach(cell => {
        handle = belts.placeBelt(cell.x, cell.y, Direction.UP);
    });

    // Feed one item; do not drain the out-port, so the popped item rests and renders.
    engine.setPortItem(handle.inPort, RED);
    const events = [];
    for (let i = 0; i < 8; i += 1) {
        engine.tickAll();
        engine.drainRenderEvents().forEach(event => events.push(event));
    }

    // The tail tile is (0,0); exactly one set for the item arriving at the out-port.
    const sets = events.filter(event => event.kind === "set");
    assert.equal(sets.length, 1);
    assert.deepEqual(sets[0], {kind: "set", portId: handle.outPort, item: RED, x: 0, y: 0});
});
