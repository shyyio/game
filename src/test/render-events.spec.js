import {test} from "node:test";
import assert from "node:assert/strict";
import {GameEngine, EMPTY} from "@/common/sim/GameEngine.js";
import {EventCollector} from "@/test/EventCollector.js";
import {SplitterBehavior} from "@/mods/Logistics/SplitterBehavior.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";

const ITEM = 7;

// A drawn out-port emits a PortItemSetEvent when it gains a resting item and a PortItemClearEvent
// when it loses one, on change only.
test("rendered out-ports emit port-item set/clear deltas on change only", async () => {
    const engine = new GameEngine();
    await engine.init();
    const collector = new EventCollector(engine);
    const splitter = new SplitterBehavior();
    splitter.install(engine);
    const s = splitter.addSplitter(engine);
    engine.registerRenderedPort(s.out_a, 5, 4);
    engine.registerRenderedPort(s.out_b, 6, 4);

    engine.setPortItem(s.out_a, ITEM);
    engine.tickAll();
    let events = collector.drain();
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof PortItemSetEvent);
    assert.equal(events[0].portId, s.out_a);
    assert.equal(events[0].itemType, ITEM);

    engine.tickAll();
    assert.deepEqual(collector.drain(), []);

    engine.setPortItem(s.out_a, EMPTY);
    engine.tickAll();
    events = collector.drain();
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof PortItemClearEvent);
    assert.equal(events[0].portId, s.out_a);
});

// The deltas leave the engine as one batch per chunk, not one event per port.
test("a render pass emits one port-item batch per chunk", async () => {
    const engine = new GameEngine();
    await engine.init();
    const emitted = [];
    engine.setEventSink(event => emitted.push(event));
    const splitter = new SplitterBehavior();
    splitter.install(engine);
    const s = splitter.addSplitter(engine);
    const far = splitter.addSplitter(engine);
    // Two ports in one chunk, a third far enough out to land in another.
    engine.registerRenderedPort(s.out_a, 5, 4);
    engine.registerRenderedPort(s.out_b, 6, 4);
    engine.registerRenderedPort(far.out_a, 5 + CHUNK_SIZE, 4);

    engine.setPortItem(s.out_a, ITEM);
    engine.setPortItem(s.out_b, ITEM);
    engine.setPortItem(far.out_a, ITEM);
    engine.tickAll();

    assert.equal(emitted.length, 2, "one batch per chunk");
    const near = emitted.find(batch => batch.chunk === chunkId(5, 4));
    assert.deepEqual(near.setPortIds, [s.out_a, s.out_b]);
    assert.deepEqual(near.setItemTypes, [ITEM, ITEM]);
    assert.deepEqual(near.clearPortIds, []);
});
