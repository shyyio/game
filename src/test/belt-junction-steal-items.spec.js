import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {GameEngine} from "@/common/sim/GameEngine.js";
import {Belts} from "@/mods/Logistics/Belts.js";

const RED = 1;
const EMPTY = -1;

// Placing a belt that feeds a tile already fed by an older belt steals the junction (highest id
// wins), orphaning the older feeder's upstream belts into their own path. The items sitting on
// those orphaned belts must carry onto the rebuilt path, not be discarded to an empty rebuild.
test("items on belts orphaned by a junction steal survive the rebuild", async () => {
    const engine = new GameEngine();
    await engine.init();
    const belts = new Belts(engine);

    // A straight UP path of four belts (flowing toward -y), fed with its out-port blocked, so RED
    // items pile solid back through the upstream belts (5,7)+(5,6). All within one chunk.
    let handle = null;
    for (const cell of [{x: 5, y: 7}, {x: 5, y: 6}, {x: 5, y: 5}, {x: 5, y: 4}]) {
        handle = belts.placeBelt(cell.x, cell.y, Direction.UP);
    }
    for (let i = 0; i < 16; i += 1) {
        engine.setPortItem(handle.inPort, RED);
        engine.tickAll();
    }

    // A newer belt feeding the mid tile (5,5) from the side wins its junction, so (5,5) adopts it
    // and the upstream (5,7)+(5,6) split off into their own orphan path.
    belts.placeBelt(4, 5, Direction.RIGHT);
    const orphan = belts.paths.find(path => path.belts.includes("5,7"));
    assert.ok(orphan !== undefined, "the orphaned upstream belts form their own path");
    const expected = orphan.items.toList().filter(item => item.type === RED).length;
    assert.ok(expected >= 2, "the orphan path carries the packed items, not an empty rebuild");

    // Isolate the orphan (no more feed) and drain its dead-end out-port each tick, counting pops.
    // Every carried half-tile must be delivered.
    engine.Port.item[orphan.inPort] = EMPTY;
    let delivered = 0;
    for (let i = 0; i < 12; i += 1) {
        engine.tickAll();
        if (engine.Port.item[orphan.outPort] === RED) {
            delivered += 1;
            engine.Port.item[orphan.outPort] = EMPTY;
        }
    }
    assert.equal(delivered, expected, "every orphaned item pops; none lost to empty rebuild");
});
