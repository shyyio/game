import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {GameEngine} from "@/common/sim/GameEngine.js";
import {Belts} from "@/mods/Logistics/Belts.js";

const RED = 1;
const EMPTY = -1;

// A deletion that splits a path re-rows the surviving sub-run's items from its half-tile
// occupancy. Packed same-type items must survive that round trip and pop one per tick — not
// collapse into a single run the mover then pops (and discards) whole.
test("packed same-type items survive a split and each still pops", async () => {
    const engine = new GameEngine();
    await engine.init();
    const belts = new Belts(engine);

    // A straight UP path of four belts, fed continuously with its out-port blocked, so RED
    // items pile solid against the output end.
    let handle = null;
    for (const cell of [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 0, y: 3}]) {
        handle = belts.placeBelt(cell.x, cell.y, Direction.UP);
    }
    for (let i = 0; i < 12; i += 1) {
        engine.setPortItem(handle.inPort, RED);
        engine.tickAll();
    }

    // Delete an upstream belt: the downstream belts (0,2)+(0,3) split into their own sub-run,
    // carrying the packed items re-rowed from occupancy.
    belts.removeBelt(0, 1, Direction.UP);
    const sub = belts.paths.find(path => path.belts.includes("0,3"));
    const expected = sub.items
        .filter(run => run.type === RED)
        .reduce((sum, run) => sum + run.length, 0);
    assert.ok(expected >= 2, "the split sub-run should carry at least two packed items");

    // Isolate the sub-run (no more upstream feed) and drain its out-port each tick, counting the
    // RED items that pop out. Every packed half-tile must be delivered.
    engine.Port.item[sub.inPort] = EMPTY;
    let delivered = 0;
    for (let i = 0; i < 12; i += 1) {
        engine.tickAll();
        if (engine.Port.item[sub.outPort] === RED) {
            delivered += 1;
            engine.Port.item[sub.outPort] = EMPTY;
        }
    }

    assert.equal(delivered, expected, "every packed item pops; none are lost to run collapse");
});
