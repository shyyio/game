import {test} from "node:test";
import assert from "node:assert/strict";
import {GameEngine} from "@/sim/GameEngine.js";
import {EMPTY} from "@/sim/sentinels.js";
import {EventCollector} from "@/test/EventCollector.js";
import {SplitterBehavior} from "@/mods/logistics/sim/SplitterBehavior.js";
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
    engine.render.registerPort(s.out_a, 5, 4);
    engine.render.registerPort(s.out_b, 6, 4);

    engine.ports.setItem(s.out_a, ITEM);
    engine.tickAll();
    let events = collector.drain();
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof PortItemSetEvent);
    assert.equal(events[0].portId, s.out_a);
    assert.equal(events[0].itemType, ITEM);

    engine.tickAll();
    assert.deepEqual(collector.drain(), []);

    engine.ports.setItem(s.out_a, EMPTY);
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
    engine.render.registerPort(s.out_a, 5, 4);
    engine.render.registerPort(s.out_b, 6, 4);
    engine.render.registerPort(far.out_a, 5 + CHUNK_SIZE, 4);

    engine.ports.setItem(s.out_a, ITEM);
    engine.ports.setItem(s.out_b, ITEM);
    engine.ports.setItem(far.out_a, ITEM);
    engine.tickAll();

    assert.equal(emitted.length, 2, "one batch per chunk");
    const near = emitted.find(batch => batch.chunk === chunkId(5, 4));
    assert.deepEqual(near.setPortIds, [s.out_a, s.out_b]);
    assert.deepEqual(near.setItemTypes, [ITEM, ITEM]);
    assert.deepEqual(near.clearPortIds, []);
});

/**
 * Boots an engine with one rendered port holding ITEM, its initial set already drained.
 * @returns {Promise<{engine: GameEngine, collector: EventCollector, port: number}>}
 */
async function riggedPort() {
    const engine = new GameEngine();
    await engine.init();
    const collector = new EventCollector(engine);
    const port = engine.ports.create(ITEM);
    engine.render.registerPort(port, 5, 4);
    engine.tickAll();
    collector.drain();
    return {engine, collector, port};
}

// A consumer eating a rendered port's item flags the clear consumed, so the client glides the
// item into the consumer instead of dropping it; a mod-cleared port stays unflagged.
test("a drained rendered port's clear is flagged consumed", async () => {
    const {engine, collector, port} = await riggedPort();

    engine.transfers.submitDrain(port, true);
    engine.transfers.resolve();
    engine.transfers.flushSinks();
    engine.tickAll();
    const events = collector.drain();
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof PortItemClearEvent);
    assert.equal(events[0].consumed, 1);

    engine.ports.setItem(port, ITEM);
    engine.tickAll();
    collector.drain();
    engine.ports.setItem(port, EMPTY);
    engine.tickAll();
    const modCleared = collector.drain();
    assert.equal(modCleared.length, 1);
    assert.ok(modCleared[0] instanceof PortItemClearEvent);
    assert.equal(modCleared[0].consumed, 0);
});

// A port consumed and refilled in one tick still emits the consumed clear ahead of the set, so
// the shown item glides out while its replacement glides in.
test("a consumed port refilled the same tick emits clear then set", async () => {
    const {engine, collector, port} = await riggedPort();

    const NEXT_ITEM = 8;
    engine.transfers.submitDrain(port, true);
    engine.transfers.resolve();
    engine.transfers.flushSinks();
    engine.ports.setItem(port, NEXT_ITEM);
    engine.tickAll();
    const events = collector.drain();
    assert.equal(events.length, 2);
    assert.ok(events[0] instanceof PortItemClearEvent);
    assert.equal(events[0].consumed, 1);
    assert.ok(events[1] instanceof PortItemSetEvent);
    assert.equal(events[1].itemType, NEXT_ITEM);
});

// A mod taking a rendered port's item and refilling it in one tick (full-throughput ingest) still
// emits a plain clear then set, so the client re-glides the new item instead of standing still.
test("a mod-emptied port refilled the same tick emits clear then set", async () => {
    const {engine, collector, port} = await riggedPort();

    engine.ports.setItem(port, EMPTY);
    engine.ports.setItem(port, ITEM);
    engine.tickAll();
    const events = collector.drain();
    assert.equal(events.length, 2);
    assert.ok(events[0] instanceof PortItemClearEvent);
    assert.equal(events[0].consumed, 0);
    assert.ok(events[1] instanceof PortItemSetEvent);
    assert.equal(events[1].itemType, ITEM);
});

// The splitter's seam eats from its in-port like any consumer, so the rendered feed item glides
// into the splitter instead of vanishing in place.
test("a splitter draining its rendered in-port emits a consumed clear", async () => {
    const engine = new GameEngine();
    await engine.init();
    const collector = new EventCollector(engine);
    const splitter = new SplitterBehavior();
    splitter.install(engine);
    const s = splitter.addSplitter(engine);
    engine.render.registerPort(s.in_a, 5, 4);
    // Jam the splitter so the fed item rests in the in-port for a tick.
    engine.ports.setItem(s.int_a, ITEM);
    engine.ports.setItem(s.out_a, ITEM);
    engine.ports.setItem(s.out_b, ITEM);
    engine.ports.setItem(s.in_a, ITEM);
    engine.tickAll();
    collector.drain();

    // Unjam: the internal hop frees, the seam eats the resting in-port item.
    engine.ports.setItem(s.out_a, EMPTY);
    engine.tickAll();
    const events = collector.drain();
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof PortItemClearEvent);
    assert.equal(events[0].portId, s.in_a);
    assert.equal(events[0].consumed, 1);
});
