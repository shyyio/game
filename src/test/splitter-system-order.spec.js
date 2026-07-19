import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {GameEngine, EMPTY} from "@/common/sim/GameEngine.js";
import {Belts} from "@/mods/Logistics/Belts.js";
import {SplitterBehavior} from "@/mods/Logistics/SplitterBehavior.js";

const RED = 1;

// Builds a belt line feeding a splitter, with the belt transport and the splitter seam registered
// in the given order, and returns the per-tick out_a/out_b item stream for a continuous input feed.
async function streamWithRegistration(beltsFirst) {
    const engine = new GameEngine();
    await engine.init();
    let belts;
    const splitter = new SplitterBehavior();
    if (beltsFirst) {
        belts = new Belts(engine);
        splitter.install(engine);
    } else {
        splitter.install(engine);
        belts = new Belts(engine);
    }

    // Belt line (5,7)->(5,6) facing UP feeds tile (5,5); the splitter adopts the shared port as in_a.
    belts.placeBelt(5, 7, Direction.UP);
    const belt = belts.placeBelt(5, 6, Direction.UP);
    const s = splitter.placeSplitter(engine, 5, 5);
    assert.equal(s.in_a, belt.outPort, "splitter in_a adopted the belt's out-port");

    const path = belts.pathAt(5, 7);
    const stream = [];
    for (let i = 0; i < 16; i += 1) {
        engine.setPortItem(path.inPort, RED);
        engine.setPortItem(s.out_a, EMPTY);
        engine.setPortItem(s.out_b, EMPTY);
        engine.tickAll();
        stream.push(`${engine.portItem(s.out_a)},${engine.portItem(s.out_b)}`);
    }
    return stream;
}

// The splitter's POST_RESOLVE seam must read shared ports before the belt transport writes pops.
// ORDER_BEFORE_TRANSPORT pins that, so the item stream is identical whichever side registers first.
test("the splitter seam runs before belt transport regardless of registration order", async () => {
    const beltsFirst = await streamWithRegistration(true);
    const splitterFirst = await streamWithRegistration(false);
    assert.deepEqual(beltsFirst, splitterFirst, "registration order must not change the item stream");
    assert.ok(splitterFirst.some(tick => tick !== `${EMPTY},${EMPTY}`), "items flow through the splitter");
});
