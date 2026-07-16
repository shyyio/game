import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {GameEngine, EMPTY} from "@/common/sim/GameEngine.js";
import {Belts} from "@/mods/Logistics/Belts.js";

const RED = 1;

// A vertical line straddling the y=64 chunk border: y=62,63 in one chunk, y=64,65 in the next.
const CELLS = [
    {x: 0, y: 62}, {x: 0, y: 63}, {x: 0, y: 64}, {x: 0, y: 65},
];

// Hard constraint: a belt line never crosses a chunk boundary — it splits into per-chunk paths
// joined at the seam. Items must still flow across the seam and all be delivered.
test("a belt line splits at the chunk boundary and items flow across the seam", async () => {
    const engine = new GameEngine();
    await engine.init();
    const belts = new Belts(engine);
    let handle = null;
    CELLS.forEach(cell => {
        handle = belts.placeBelt(cell.x, cell.y, Direction.UP);
    });

    assert.equal(handle.segments.length, 2, "the line is two per-chunk paths, not one crossing the border");

    const outStream = [];
    for (let i = 0; i < 24; i += 1) {
        engine.setPortItem(handle.outPort, EMPTY);
        if (i < 3) {
            engine.setPortItem(handle.inPort, RED);
        }
        engine.tickAll();
        outStream.push(engine.portItem(handle.outPort));
    }

    assert.equal(outStream.filter(item => item === RED).length, 3, "all three items delivered across the seam");
});
