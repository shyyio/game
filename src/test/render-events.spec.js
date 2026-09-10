import {test} from "node:test";
import assert from "node:assert/strict";
import {GameEngine} from "@/sim/GameEngine.js";
import {EMPTY} from "@/sim/sentinels.js";
import {EventCollector} from "@/test/EventCollector.js";
import {SplitterBehavior} from "@/mods/logistics/sim/SplitterBehavior.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {chunkKeyAt} from "@/common/util.js";

const ITEM = 7;

// A drawn output port emits a PortItemSetEvent when it gains a resting item and a PortItemClearEvent
// when it loses one, on change only.
test("rendered output ports emit port-item set/clear deltas on change only", async () => {
    const engine = new GameEngine();
    await engine.init();
    const collector = new EventCollector(engine);
    const splitter = new SplitterBehavior();
    splitter.install(engine);
    const s = splitter.addSplitter(engine);
    engine.portItems.addOutputPort(s.outputPortA, 5, 4);
    engine.portItems.addOutputPort(s.outputPortB, 6, 4);

    engine.ports.setItem(s.outputPortA, ITEM);
    engine.tick();
    let events = collector.drain();
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof PortItemSetEvent);
    assert.equal(events[0].portRef, s.outputPortA);
    assert.equal(events[0].itemTypeId, ITEM);

    engine.tick();
    assert.deepEqual(collector.drain(), []);

    engine.ports.setItem(s.outputPortA, EMPTY);
    engine.tick();
    events = collector.drain();
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof PortItemClearEvent);
    assert.equal(events[0].portRef, s.outputPortA);
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
    engine.portItems.addOutputPort(s.outputPortA, 5, 4);
    engine.portItems.addOutputPort(s.outputPortB, 6, 4);
    engine.portItems.addOutputPort(far.outputPortA, 5 + CHUNK_SIZE, 4);

    engine.ports.setItem(s.outputPortA, ITEM);
    engine.ports.setItem(s.outputPortB, ITEM);
    engine.ports.setItem(far.outputPortA, ITEM);
    engine.tick();

    assert.equal(emitted.length, 2, "one batch per chunk");
    const near = emitted.find(batch => batch.chunkKey === chunkKeyAt(5, 4));
    assert.deepEqual(near.setPortRefs, [s.outputPortA, s.outputPortB]);
    assert.deepEqual(near.setItemTypeIds, [ITEM, ITEM]);
    assert.deepEqual(near.clearPortRefs, []);
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
    engine.portItems.addOutputPort(port, 5, 4);
    engine.tick();
    collector.drain();
    return {engine, collector, port};
}

// A consumer eating a rendered port's item flags the clear consumed, so the client glides the
// item into the consumer instead of dropping it; a mod-cleared port stays unflagged.
test("a drained rendered port's clear is flagged consumed", async () => {
    const {engine, collector, port} = await riggedPort();

    engine.ports.consumeItem(port);
    engine.tick();
    const events = collector.drain();
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof PortItemClearEvent);
    assert.equal(events[0].consumed, 1);

    engine.ports.setItem(port, ITEM);
    engine.tick();
    collector.drain();
    engine.ports.setItem(port, EMPTY);
    engine.tick();
    const modCleared = collector.drain();
    assert.equal(modCleared.length, 1);
    assert.ok(modCleared[0] instanceof PortItemClearEvent);
    assert.equal(modCleared[0].consumed, 0);
});

// A transport that takes a rendered port's item draws it onward itself, so the clear is plain.
test("a consumed port a transport carried on renders a plain clear", async () => {
    const {engine, collector, port} = await riggedPort();

    engine.ports.consumeItem(port);
    engine.portItems.noteConveyed(port);
    engine.tick();
    const events = collector.drain();
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof PortItemClearEvent);
    assert.equal(events[0].consumed, 0);
});

// A port consumed and refilled in one tick still emits the consumed clear ahead of the set, so
// the shown item glides out while its replacement glides in.
test("a consumed port refilled the same tick emits clear then set", async () => {
    const {engine, collector, port} = await riggedPort();

    const NEXT_ITEM = 8;
    engine.ports.consumeItem(port);
    engine.ports.setItem(port, NEXT_ITEM);
    engine.tick();
    const events = collector.drain();
    assert.equal(events.length, 2);
    assert.ok(events[0] instanceof PortItemClearEvent);
    assert.equal(events[0].consumed, 1);
    assert.ok(events[1] instanceof PortItemSetEvent);
    assert.equal(events[1].itemTypeId, NEXT_ITEM);
});

// A mod taking a rendered port's item and refilling it in one tick (full-throughput ingest) still
// emits a plain clear then set, so the client re-glides the new item instead of standing still.
test("a mod-emptied port refilled the same tick emits clear then set", async () => {
    const {engine, collector, port} = await riggedPort();

    engine.ports.setItem(port, EMPTY);
    engine.ports.setItem(port, ITEM);
    engine.tick();
    const events = collector.drain();
    assert.equal(events.length, 2);
    assert.ok(events[0] instanceof PortItemClearEvent);
    assert.equal(events[0].consumed, 0);
    assert.ok(events[1] instanceof PortItemSetEvent);
    assert.equal(events[1].itemTypeId, ITEM);
});

// The splitter transfers out of its input port like any consumer, so the rendered feed item glides
// into the splitter instead of vanishing in place.
test("a splitter draining its rendered input port emits a consumed clear", async () => {
    const engine = new GameEngine();
    await engine.init();
    const collector = new EventCollector(engine);
    const splitter = new SplitterBehavior();
    splitter.install(engine);
    const s = splitter.addSplitter(engine);
    engine.portItems.addOutputPort(s.inputPortA, 5, 4);
    // Jam the splitter so the fed item rests in the input port for a tick.
    engine.ports.setItem(s.internalPortA, ITEM);
    engine.ports.setItem(s.outputPortA, ITEM);
    engine.ports.setItem(s.outputPortB, ITEM);
    engine.ports.setItem(s.inputPortA, ITEM);
    engine.tick();
    collector.drain();

    // Unjam: the internal hop frees, the resting input port item transfers into it.
    engine.ports.setItem(s.outputPortA, EMPTY);
    engine.tick();
    const events = collector.drain();
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof PortItemClearEvent);
    assert.equal(events[0].portRef, s.inputPortA);
    assert.equal(events[0].consumed, 1);
});
