import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {GameEngine} from "@/common/sim/GameEngine.js";
import {EventCollector} from "@/test/EventCollector.js";
import {Belts} from "@/mods/Logistics/Belts.js";
import {PortItemSetEvent} from "@/common/PortItemEvents.js";

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
