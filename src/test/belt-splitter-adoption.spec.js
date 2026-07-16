import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {GameEngine, EMPTY} from "@/common/sim/GameEngine.js";
import {Belts} from "@/mods/Logistics/Belts.js";
import {SplitterBehavior} from "@/mods/Logistics/SplitterBehavior.js";

const RED = 1;

// Placing a splitter above a belt's output edge auto-adopts the shared port (no manual wiring), and
// an item flows belt -> splitter.
test("a splitter adopts an adjacent belt's port and receives its items", async () => {
    const engine = new GameEngine();
    await engine.init();
    const splitter = new SplitterBehavior(); // installed before belt for POST_RESOLVE seam order
    splitter.install(engine);
    const belts = new Belts(engine);

    // Belt at (5,6) facing UP feeds tile (5,5). Splitter at (5,5): in_a adopts the belt's out-port.
    const belt = belts.placeBelt(5, 6, Direction.UP);
    const s = splitter.placeSplitter(engine, 5, 5);

    assert.equal(s.in_a, belt.outPort, "splitter in_a adopted the belt's out-port");

    engine.setPortItem(belt.inPort, RED);
    let arrived = false;
    for (let i = 0; i < 8 && !arrived; i += 1) {
        engine.tickAll();
        arrived = engine.portItem(s.out_a) === RED || engine.portItem(s.out_b) === RED;
    }
    assert.ok(arrived, "the item flowed from the belt through the splitter to an output");
});
