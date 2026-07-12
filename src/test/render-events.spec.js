import {test} from "node:test";
import assert from "node:assert/strict";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";
import {SplitterModule} from "@/common/sim/SplitterSystems.js";
import {BufferedEvent} from "@/common/BufferedEvent.js";
import {BUFFERED_EVENT_TYPE_PORT_ITEM_SET, BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR} from "@/common/constants.js";

const ITEM = 7;

// A drawn out-port emits a BufferedEvent PORT_ITEM_SET when it gains a resting item and PORT_ITEM_CLEAR
// when it loses one — the same wire events the SQL engine journals, so the client renders unchanged.
test("rendered out-ports emit PORT_ITEM set/clear deltas on change only", async () => {
    const engine = new EcsEngine();
    await engine.init();
    const splitter = new SplitterModule(engine);
    const s = splitter.addSplitter();
    engine.registerRenderedPort(s.out_a, 5, 4);
    engine.registerRenderedPort(s.out_b, 6, 4);

    engine.setPortItem(s.out_a, ITEM);
    engine.tickAll();
    let events = engine.drainEvents();
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof BufferedEvent);
    assert.equal(events[0].type, BUFFERED_EVENT_TYPE_PORT_ITEM_SET);
    assert.equal(events[0].id, BigInt(s.out_a));
    assert.equal(events[0].a, ITEM);

    engine.tickAll();
    assert.deepEqual(engine.drainEvents(), []);

    engine.setPortItem(s.out_a, EMPTY);
    engine.tickAll();
    events = engine.drainEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].type, BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR);
    assert.equal(events[0].id, BigInt(s.out_a));
});
