import {test} from "node:test";
import assert from "node:assert/strict";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";
import {SplitterModule} from "@/common/sim/SplitterSystems.js";

const ITEM = 7;

// The bitECS engine emits a set event when a drawn out-port gains a resting item and a clear event
// when it loses one (the semantic equivalent of the SQL PORT_ITEM_SET / PORT_ITEM_CLEAR deltas).
test("rendered out-ports emit set/clear item deltas on change only", async () => {
    const engine = new EcsEngine();
    await engine.init();
    const splitter = new SplitterModule(engine);
    const s = splitter.addSplitter();
    engine.registerRenderedPort(s.out_a, 5, 4);
    engine.registerRenderedPort(s.out_b, 6, 4);

    // Rest an item in out_a (no downstream, so it stays put).
    engine.setPortItem(s.out_a, ITEM);
    engine.tickAll();
    assert.deepEqual(engine.drainRenderEvents(), [{kind: "set", portId: s.out_a, item: ITEM, x: 5, y: 4}]);

    // No change next tick -> no event.
    engine.tickAll();
    assert.deepEqual(engine.drainRenderEvents(), []);

    // Item leaves -> a clear.
    engine.setPortItem(s.out_a, EMPTY);
    engine.tickAll();
    assert.deepEqual(engine.drainRenderEvents(), [{kind: "clear", portId: s.out_a, x: 5, y: 4}]);
});
