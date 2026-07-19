import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {GameEngine} from "@/common/sim/GameEngine.js";
import {EventCollector} from "@/test/EventCollector.js";
import {Belts} from "@/mods/Logistics/Belts.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";

const RED = 1;

// A belt's out-port (drawn at the tail tile) emits a PortItemSetEvent when a popped item rests there.
test("a belt emits a port-item set when an item pops to its out-port", async () => {
    const engine = new GameEngine();
    await engine.init();
    const collector = new EventCollector(engine);
    const belts = new Belts(engine);
    let handle = null;
    for (const cell of [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}]) {
        handle = belts.placeBelt(cell.x, cell.y, Direction.UP);
    }
    collector.drain(); // discard placement events

    engine.setPortItem(handle.inPort, RED);
    const sets = [];
    for (let i = 0; i < 8; i += 1) {
        engine.tickAll();
        for (const event of collector.drain()) {
            if (event instanceof PortItemSetEvent) {
                sets.push(event);
            }
        }
    }

    assert.equal(sets.length, 1);
    assert.equal(sets[0].portId, handle.outPort);
    assert.equal(sets[0].itemType, RED);
});

// Deleting the output belt strands its out-port; the port sweep must still emit the deferred clear,
// or the client's resting item sprite leaks.
test("deleting the output belt emits a port-item clear for the stranded out-port", async () => {
    const engine = new GameEngine();
    await engine.init();
    const collector = new EventCollector(engine);
    const belts = new Belts(engine);
    let handle = null;
    for (const cell of [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}]) {
        handle = belts.placeBelt(cell.x, cell.y, Direction.UP);
    }
    engine.setPortItem(handle.inPort, RED);
    for (let i = 0; i < 8; i += 1) {
        engine.tickAll();
    }
    collector.drain(); // discard placement and set events

    // The tail belt at (0, 0); its removal relinks the run, then the sweep destroys the old out-port.
    belts.removeBelt(0, 0, Direction.UP);
    engine.collectUnreferencedPorts();

    const clears = collector.drain().filter(event => event instanceof PortItemClearEvent);
    assert.equal(clears.length, 1);
    assert.equal(clears[0].portId, handle.outPort);
});
