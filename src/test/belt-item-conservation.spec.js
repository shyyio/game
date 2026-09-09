import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {tileKeyAt} from "@/common/util.js";
import {GameEngine, TickPhase} from "@/sim/GameEngine.js";
import {Belts} from "@/mods/logistics/sim/Belts.js";

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
        engine.ports.setItem(handle.inPort, RED);
        engine.tickAll();
    }

    // Delete an upstream belt: the downstream belts (0,2)+(0,3) split into their own sub-run,
    // carrying the packed items re-rowed from occupancy.
    belts.removeBelt(0, 1, Direction.UP);
    const sub = belts.paths.find(path => path.belts.includes(tileKeyAt(0, 3)));
    const expected = belts.itemsOf(sub).filter(item => item.type === RED).length;
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

// A producer creating into the belt's out-port beats the belt's own transfer there; the belt then
// keeps its lead rather than popping an item nothing carried.
test("a belt losing its out-port to another producer keeps its lead", async () => {
    const engine = new GameEngine();
    await engine.init();
    const belts = new Belts(engine);
    const OTHER = 2;
    let handle = null;
    for (const cell of [{x: 0, y: 0}, {x: 0, y: 1}]) {
        handle = belts.placeBelt(cell.x, cell.y, Direction.UP);
    }
    let contend = false;
    engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => {
        if (contend) {
            engine.transfers.submitCreate(handle.outPort, OTHER, true);
        }
    });

    // Block the out-port so the fed item piles against it.
    engine.ports.setItem(handle.outPort, OTHER);
    engine.ports.setItem(handle.inPort, RED);
    for (let i = 0; i < 8; i += 1) {
        engine.tickAll();
    }
    assert.equal(belts.itemCountOf(belts.paths[0]), 1);

    engine.ports.setItem(handle.outPort, EMPTY);
    contend = true;
    engine.tickAll();

    assert.equal(engine.ports.item(handle.outPort), OTHER);
    assert.equal(belts.itemCountOf(belts.paths[0]), 1, "the lead the other producer beat stays on the belt");
});

// A belt ingests only what its own drain or pop emptied; an in-port emptied by anything else
// carried nothing onto the belt.
test("a belt does not ingest an in-port item something else took", async () => {
    const engine = new GameEngine();
    await engine.init();
    const belts = new Belts(engine);
    const OTHER = 2;
    let handle = null;
    for (const cell of [{x: 0, y: 0}, {x: 0, y: 1}]) {
        handle = belts.placeBelt(cell.x, cell.y, Direction.UP);
    }
    let steal = false;
    engine.registerSystem(TickPhase.POST_RESOLVE, () => {
        if (steal) {
            engine.ports.consumeItem(handle.inPort);
        }
    }, -1);

    // Block the out-port and feed until the path is packed, leaving an item resting at the in-port.
    engine.ports.setItem(handle.outPort, OTHER);
    for (let i = 0; i < 16; i += 1) {
        engine.ports.setItem(handle.inPort, RED);
        engine.tickAll();
    }
    const packed = belts.itemCountOf(belts.paths[0]);
    engine.ports.setItem(handle.inPort, RED);
    engine.tickAll();
    assert.equal(engine.ports.item(handle.inPort), RED, "a packed path leaves the in-port item resting");

    steal = true;
    engine.tickAll();

    assert.equal(engine.ports.item(handle.inPort), EMPTY);
    assert.equal(belts.itemCountOf(belts.paths[0]), packed, "nothing reached the belt");
});
