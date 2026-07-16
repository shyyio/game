import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {GameEngine, EMPTY} from "@/common/sim/GameEngine.js";
import {Belts} from "@/mods/Logistics/Belts.js";
import {BELT_RAMP_DOWN} from "@/mods/Logistics/constants.js";

const RED = 1;

// A 3x3 ring of normal belts, clockwise from the top-left (matching the old Belt.spec buildRing3x3).
function buildRing3x3(belts) {
    [
        [0, 0, Direction.RIGHT], [1, 0, Direction.RIGHT], [2, 0, Direction.DOWN], [2, 1, Direction.DOWN],
        [2, 2, Direction.LEFT], [1, 2, Direction.LEFT], [0, 2, Direction.UP], [0, 1, Direction.UP],
    ].forEach(([x, y, direction]) => belts.placeBelt(x, y, direction));
}

async function module() {
    const engine = new GameEngine();
    await engine.init();
    return {engine, belts: new Belts(engine)};
}

// The path whose belts include tile (x, y).
function pathThrough(belts, x, y) {
    return belts.paths.find(path => path.belts.includes(`${x},${y}`));
}

// A straight run of same-direction belts builds one path of the right length; the head is the most
// upstream belt and the out-port sits past the tail. (Belt.spec: "Builds BeltPaths ... across straight runs".)
test("a straight run builds one path of the right length", async () => {
    const {belts} = await module();
    belts.placeBelt(0, 0, Direction.RIGHT);
    belts.placeBelt(1, 0, Direction.RIGHT);
    belts.placeBelt(2, 0, Direction.RIGHT);

    assert.equal(belts.paths.length, 1);
    assert.deepEqual(belts.paths[0].belts, ["0,0", "1,0", "2,0"]);
    assert.equal(belts.paths[0].length, 3 * 2 - 1);
});

// Placing a belt that feeds the middle of a run splits it: the new belt steals the downstream (its
// path bends through the junction to the old tail), and the upstream is left a shorter path.
// (Belt.spec: "Builds BeltPaths ... " second half + "Sets each belt's parent to the belt it flows into".)
test("a belt feeding a run's middle splits it and steals the downstream", async () => {
    const {belts} = await module();
    belts.placeBelt(0, 0, Direction.RIGHT);
    belts.placeBelt(1, 0, Direction.RIGHT);
    belts.placeBelt(2, 0, Direction.RIGHT);

    belts.placeBelt(1, 2, Direction.UP);
    belts.placeBelt(1, 1, Direction.UP);

    const stolen = pathThrough(belts, 2, 0);
    assert.deepEqual(stolen.belts, ["1,2", "1,1", "1,0", "2,0"], "the new belt bends through the junction to the old tail");
    assert.equal(stolen.length, 4 * 2 - 1);

    const upstream = pathThrough(belts, 0, 0);
    assert.deepEqual(upstream.belts, ["0,0"], "the upstream belt is left on its own shorter path");
    assert.equal(upstream.length, 1);
});

// A resting out-port item belongs to whichever path owns the tail, so a split hands it to the stolen
// downstream path. (Belt.spec: "Moves the output item to the tail path when a branch splits a run".)
test("a split hands a resting out-port item to the stolen downstream path", async () => {
    const {engine, belts} = await module();
    belts.placeBelt(0, 0, Direction.RIGHT);
    belts.placeBelt(1, 0, Direction.RIGHT);
    const run = belts.placeBelt(2, 0, Direction.RIGHT);
    engine.setPortItem(run.outPort, RED);

    belts.placeBelt(1, 2, Direction.UP);
    belts.placeBelt(1, 1, Direction.UP);

    const stolen = pathThrough(belts, 2, 0);
    const upstream = pathThrough(belts, 0, 0);
    assert.equal(engine.portItem(stolen.outPort), RED, "the item stays in the tail's out-port, now owned by the stolen path");
    assert.equal(engine.portItem(upstream.outPort), EMPTY, "the shortened upstream path's out-port is empty");
});

// Prepending an upstream belt is a head extension: the out-port doesn't move, so a resting item stays.
// (Belt.spec: "Keeps the output item when a belt is prepended to a run".)
test("prepending an upstream belt keeps a resting out-port item", async () => {
    const {engine, belts} = await module();
    const run = belts.placeBelt(1, 0, Direction.RIGHT);
    engine.setPortItem(run.outPort, RED);

    belts.placeBelt(0, 0, Direction.RIGHT);

    const path = pathThrough(belts, 1, 0);
    assert.deepEqual(path.belts, ["0,0", "1,0"]);
    assert.equal(engine.portItem(path.outPort), RED, "the out-port item survives the prepend");
});

// A bent path is one contiguous run through the corner; an item flows around the bend to the out-port.
test("an item flows around a bend to the out-port", async () => {
    const {engine, belts} = await module();
    belts.placeBelt(0, 0, Direction.RIGHT);
    belts.placeBelt(1, 0, Direction.RIGHT);
    belts.placeBelt(2, 0, Direction.UP);
    const path = pathThrough(belts, 0, 0);
    assert.deepEqual(path.belts, ["0,0", "1,0", "2,0"], "the corner belt joins the same path");

    engine.setPortItem(path.inPort, RED);
    let delivered = 0;
    for (let i = 0; i < 12; i += 1) {
        engine.setPortItem(path.outPort, EMPTY);
        engine.tickAll();
        if (engine.portItem(path.outPort) === RED) {
            delivered += 1;
        }
    }
    assert.equal(delivered, 1, "the item is delivered around the bend");
});

// A closed loop is one path that shares a single port for both ends. (Belt.spec: "Forms a closed loop
// into a single path" + "Circulates an item around a shared-port loop".)
test("a closed loop is one path sharing one port, and an item circulates", async () => {
    const {engine, belts} = await module();
    belts.placeBelt(0, 0, Direction.RIGHT);
    belts.placeBelt(1, 0, Direction.DOWN);
    belts.placeBelt(1, 1, Direction.LEFT);
    belts.placeBelt(0, 1, Direction.UP);

    assert.equal(belts.paths.length, 1);
    assert.equal(belts.paths[0].length, 4 * 2 - 1);
    assert.equal(belts.paths[0].inPort, belts.paths[0].outPort, "the loop shares one port for both ends");

    // Seed one item and let it lap with no external feed; it is never lost and rests in the port on
    // more than one lap.
    engine.setPortItem(belts.paths[0].outPort, RED);
    let rests = 0;
    for (let i = 0; i < 16; i += 1) {
        engine.tickAll();
        const inPort = engine.portItem(belts.paths[0].outPort) === RED ? 1 : 0;
        const onBelt = belts.paths[0].items.filter(run => run.type !== 0).length;
        assert.equal(inPort + onBelt, 1, "exactly one item exists at all times");
        rests += inPort;
    }
    assert.ok(rests >= 2, `the item laps (rested in the port ${rests} ticks)`);
});

// Deleting any ring belt opens the loop into one connected run of the rest. (Belt.spec: "Merges the
// remainder of a loop into one path when a belt is deleted" / "Opens a loop cleanly when its seam head
// is deleted".)
test("deleting a ring belt opens the loop into one path", async () => {
    const {belts} = await module();
    buildRing3x3(belts);
    assert.equal(belts.paths.length, 1);

    belts.removeBelt(2, 2, Direction.LEFT);

    assert.equal(belts.paths.length, 1);
    assert.equal(belts.paths[0].length, 7 * 2 - 1, "the seven survivors form one open run");
});

// A deletion that removes a belt's chosen feeder lets an older straight feeder take over, merging the
// two runs. (Belt.spec: "Merges an orphaned head into a junction feeder exposed by a deletion".)
test("deleting a junction feeder merges the orphaned run into its straight feeder", async () => {
    const {belts} = await module();
    belts.placeBelt(12, 3, Direction.RIGHT); // straight feeder from the west
    belts.placeBelt(13, 4, Direction.UP);    // junction feeder from the south (parents (13,3))
    belts.placeBelt(13, 3, Direction.RIGHT);
    belts.placeBelt(14, 3, Direction.RIGHT);
    assert.equal(belts.paths.length, 2);

    belts.removeBelt(13, 4, Direction.UP);

    assert.equal(belts.paths.length, 1);
    assert.deepEqual(pathThrough(belts, 13, 3).belts, ["12,3", "13,3", "14,3"]);
});

// A path never spans a chunk border, so a cross-chunk feeder stays a separate port-linked path even
// after a deletion orphans its child. (Belt.spec: "Keeps a cross-chunk junction feeder as a port link".)
test("a cross-chunk feeder stays its own path when a deletion orphans its child", async () => {
    const {belts} = await module();
    belts.placeBelt(63, 3, Direction.RIGHT); // chunk 0
    belts.placeBelt(64, 4, Direction.UP);    // chunk 1, parents (64,3)
    belts.placeBelt(64, 3, Direction.RIGHT); // chunk 1
    belts.placeBelt(65, 3, Direction.RIGHT); // chunk 1

    belts.removeBelt(64, 4, Direction.UP);

    assert.equal(belts.paths.length, 2, "the cross-border feeder does not fold in");
    const covered = new Set(belts.paths.flatMap(path => path.belts));
    ["63,3", "64,3", "65,3"].forEach(key => assert.ok(covered.has(key), `${key} still belongs to a path`));
});

// A ramp-down's output is buried, so it is not a valid surface feeder even with a higher id: it can't
// steal a junction from a normal belt. (Belt.spec: "Heals a loop seam past an incompatible higher-id belt".)
test("a higher-id ramp-down does not steal a surface junction", async () => {
    const {belts} = await module();
    belts.placeBelt(0, 0, Direction.UP);   // flows into (0,-1)
    belts.placeBelt(0, 1, Direction.UP);   // feeds (0,0) from the south
    // A ramp-down at (0,1)'s... place one pointing into (0,0) with a higher id; its buried output must
    // not connect to the surface belt, so (0,0) keeps its normal feeder.
    belts.placeBelt(-1, 0, Direction.RIGHT); // normal feeder into (0,0), higher id — this one wins
    const beforeRamp = pathThrough(belts, 0, 0).belts.slice();

    belts.placeBelt(1, 0, Direction.LEFT, BELT_RAMP_DOWN);
    // The ramp-down at (1,0) faces LEFT into (0,0) but its output is buried, so (0,0)'s run is unchanged.
    assert.deepEqual(pathThrough(belts, 0, 0).belts, beforeRamp, "the ramp-down did not steal the junction");
});

// The half-tile items on the surviving belts are kept when a belt is deleted (the path splits or
// shortens). (Belt.spec: "Stashes items when the tail belt is deleted" / "Splits the path and stashes
// items when a middle belt is deleted" / "Keeps downstream items when the head belt is deleted".)

// Count of real (non-gap) item cells across all paths.
function itemCells(belts) {
    return belts.paths.flatMap(path => path.items).filter(run => run.type !== 0).reduce((sum, run) => sum + run.length, 0);
}

test("an in-flight item survives deletion of a downstream belt and is still delivered", async () => {
    const {engine, belts} = await module();
    // Belts (0,4)->..->(0,0) facing UP: head (0,4), tail (0,0).
    [4, 3, 2, 1, 0].forEach(y => belts.placeBelt(0, y, Direction.UP));
    let path = belts.pathAt(0, 4);
    engine.setPortItem(path.inPort, RED);
    engine.tickAll();
    engine.tickAll();
    assert.equal(itemCells(belts), 1, "the item is in flight on an upstream belt");

    // Delete the tail (downstream of the item). The item is upstream, so it survives on the shorter path.
    belts.removeBelt(0, 0, Direction.UP);
    assert.equal(itemCells(belts), 1, "the item is kept after the downstream belt is deleted");

    path = belts.pathAt(0, 4);
    let delivered = 0;
    for (let i = 0; i < 12; i += 1) {
        engine.setPortItem(path.outPort, EMPTY);
        engine.tickAll();
        if (engine.portItem(path.outPort) === RED) {
            delivered += 1;
        }
    }
    assert.equal(delivered, 1, "the surviving item is still delivered to the shortened path's out-port");
});

test("an in-flight item survives deletion of an upstream belt", async () => {
    const {engine, belts} = await module();
    [4, 3, 2, 1, 0].forEach(y => belts.placeBelt(0, y, Direction.UP));
    const path = belts.pathAt(0, 4);
    engine.setPortItem(path.inPort, RED);
    // Move the item well downstream of the head before deleting the head.
    for (let i = 0; i < 5; i += 1) {
        engine.tickAll();
    }
    assert.equal(itemCells(belts), 1, "the item is in flight downstream");

    // Delete the head (upstream of the item). The item is on the downstream split and is kept.
    belts.removeBelt(0, 4, Direction.UP);
    assert.equal(itemCells(belts), 1, "the downstream item is kept after the head belt is deleted");
});

// Filling a gap that folds a detached downstream belt into the source keeps the source's in-flight
// item. (Belt.spec: "Keeps an in-flight item on the source belt when a gap is filled to merge two paths".)
test("filling a gap to merge two paths keeps the source's in-flight item", async () => {
    const {engine, belts} = await module();
    belts.placeBelt(12, 6, Direction.UP); // source
    belts.placeBelt(12, 4, Direction.UP); // detached downstream, gap at (12,5)
    const source = belts.pathAt(12, 6);
    engine.setPortItem(source.inPort, RED);
    engine.tickAll();
    assert.equal(itemCells(belts), 1, "the item rests on the source belt");

    belts.placeBelt(12, 5, Direction.UP);

    assert.equal(belts.paths.length, 1, "the two paths fold into one");
    assert.equal(itemCells(belts), 1, "the item is kept through the merge");
    const path = pathThrough(belts, 12, 6);
    let delivered = 0;
    for (let i = 0; i < 10; i += 1) {
        engine.setPortItem(path.outPort, EMPTY);
        engine.tickAll();
        if (engine.portItem(path.outPort) === RED) {
            delivered += 1;
        }
    }
    assert.equal(delivered, 1, "the merged item is still delivered");
});

// Filling a gap keeps an item resting in the sink belt's in-port (the buried interior boundary).
// (Belt.spec: "Keeps an item resting in the sink belt's in-port when a gap is filled to merge two paths".)
test("filling a gap to merge two paths keeps an item resting in the sink's in-port", async () => {
    const {engine, belts} = await module();
    belts.placeBelt(12, 6, Direction.UP);
    const sink = belts.placeBelt(12, 4, Direction.UP);
    engine.setPortItem(sink.inPort, RED);

    belts.placeBelt(12, 5, Direction.UP);

    assert.equal(itemCells(belts), 1, "the sink in-port item re-materializes on the belt, not lost");
    const path = pathThrough(belts, 12, 6);
    let delivered = 0;
    for (let i = 0; i < 10; i += 1) {
        engine.setPortItem(path.outPort, EMPTY);
        engine.tickAll();
        if (engine.portItem(path.outPort) === RED) {
            delivered += 1;
        }
    }
    assert.equal(delivered, 1, "the re-materialized item is delivered");
});

// A resting out-port item re-ingests onto the connecting belt when the tail merges onto a downstream
// belt. (Belt.spec: "Re-ingests a resting output item when the tail merges onto a downstream belt".)
test("a tail merge re-ingests a resting out-port item onto the connecting belt", async () => {
    const {engine, belts} = await module();
    belts.placeBelt(0, 0, Direction.RIGHT);
    belts.placeBelt(1, 0, Direction.RIGHT);
    const run = belts.placeBelt(2, 0, Direction.RIGHT);
    belts.placeBelt(4, 0, Direction.RIGHT); // detached downstream, gap at (3,0)
    engine.setPortItem(run.outPort, RED);

    belts.placeBelt(3, 0, Direction.RIGHT); // connects (2,0) -> (3,0) -> (4,0)

    assert.equal(engine.portItem(run.outPort), EMPTY, "the old out-port is cleared (not carried a tile forward)");
    assert.equal(itemCells(belts), 1, "the item re-ingests onto the belt line, not lost");
    const path = pathThrough(belts, 0, 0);
    let delivered = 0;
    for (let i = 0; i < 12; i += 1) {
        engine.setPortItem(path.outPort, EMPTY);
        engine.tickAll();
        if (engine.portItem(path.outPort) === RED) {
            delivered += 1;
        }
    }
    assert.equal(delivered, 1, "the re-ingested item reaches the merged output");
});
