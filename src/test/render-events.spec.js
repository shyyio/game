import {test} from "node:test";
import assert from "node:assert/strict";
import {GameEngine, EMPTY} from "@/common/sim/GameEngine.js";
import {SplitterModule} from "@/mods/Logistics/SplitterModule.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";

const ITEM = 7;

// A drawn out-port emits a PortItemSetEvent when it gains a resting item and a PortItemClearEvent
// when it loses one, on change only.
test("rendered out-ports emit port-item set/clear deltas on change only", async () => {
    const engine = new GameEngine();
    await engine.init();
    const splitter = new SplitterModule(engine);
    const s = splitter.addSplitter();
    engine.registerRenderedPort(s.out_a, 5, 4);
    engine.registerRenderedPort(s.out_b, 6, 4);

    engine.setPortItem(s.out_a, ITEM);
    engine.tickAll();
    let events = engine.drainEvents();
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof PortItemSetEvent);
    assert.equal(events[0].portId, s.out_a);
    assert.equal(events[0].itemType, ITEM);

    engine.tickAll();
    assert.deepEqual(engine.drainEvents(), []);

    engine.setPortItem(s.out_a, EMPTY);
    engine.tickAll();
    events = engine.drainEvents();
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof PortItemClearEvent);
    assert.equal(events[0].portId, s.out_a);
});
