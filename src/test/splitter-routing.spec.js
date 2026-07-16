import {test} from "node:test";
import assert from "node:assert/strict";
import {GameEngine, EMPTY} from "@/common/sim/GameEngine.js";
import {SplitterBehavior} from "@/mods/Logistics/SplitterBehavior.js";

const RED = 1;

// A splitter fed a continuous stream on one input must balance it round-robin across both outputs,
// not dump everything on one — the 2-out distribution logic the SQL splitter ops used to own.
test("a splitter round-robins a single input stream across both outputs", async () => {
    const engine = new GameEngine();
    await engine.init();
    const splitter = new SplitterBehavior();
    splitter.install(engine);
    const s = splitter.addSplitter(engine);

    let toA = 0;
    let toB = 0;
    for (let i = 0; i < 24; i += 1) {
        engine.setPortItem(s.in_a, RED);
        engine.setPortItem(s.out_a, EMPTY);
        engine.setPortItem(s.out_b, EMPTY);
        engine.tickAll();
        if (engine.portItem(s.out_a) === RED) {
            toA += 1;
        }
        if (engine.portItem(s.out_b) === RED) {
            toB += 1;
        }
    }

    assert.ok(toA > 0, "some items exit out_a");
    assert.ok(toB > 0, "some items exit out_b");
    assert.ok(Math.abs(toA - toB) <= 1, `balanced within one (out_a=${toA}, out_b=${toB})`);
});
