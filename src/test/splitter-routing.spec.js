import {test} from "node:test";
import assert from "node:assert/strict";
import {GameEngine} from "@/sim/GameEngine.js";
import {EMPTY} from "@/sim/sentinels.js";
import {SplitterBehavior} from "@/mods/logistics/sim/SplitterBehavior.js";

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
        engine.ports.setItem(s.inputPortA, RED);
        engine.ports.setItem(s.outputPortA, EMPTY);
        engine.ports.setItem(s.outputPortB, EMPTY);
        engine.tick();
        if (engine.ports.getItemByPortEid(s.outputPortA) === RED) {
            toA += 1;
        }
        if (engine.ports.getItemByPortEid(s.outputPortB) === RED) {
            toB += 1;
        }
    }

    assert.ok(toA > 0, "some items exit outputPortA");
    assert.ok(toB > 0, "some items exit outputPortB");
    assert.ok(Math.abs(toA - toB) <= 1, `balanced within one (outputPortA=${toA}, outputPortB=${toB})`);
});
