import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";
import {EcsEngine, EMPTY} from "@/common/sim/EcsEngine.js";
import {BeltModule} from "@/mods/Logistics/BeltModule.js";
import {BeltPathRecalculateEvent, BeltItemSyncEvent} from "@/mods/Logistics/events.js";

const RED = 1;

// Regression: extending a path at its output (downstream) edge while an item is in flight must not
// drop the item — the new belt is empty space at the output edge, so the item keeps travelling.
test("extending a belt path downstream preserves an in-flight item", async () => {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);

    // Belts (0,5)->(0,4)->(0,3) facing UP: head (in-port) at (0,5), tail (out-port) at (0,3). Kept
    // clear of the y=0 chunk border so the extension stays a single-chunk path.
    [{x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}].forEach(cell => belts.placeBelt(cell.x, cell.y, Direction.UP));

    let path = belts.pathAt(0, 5);
    // Feed one item and let it travel partway down the path.
    engine.setPortItem(path.inPort, RED);
    engine.tickAll();
    engine.tickAll();

    // The item is now an in-flight RLE run, not yet popped.
    const inFlight = belts.paths[0].items.filter(run => run.type === RED).length;
    assert.equal(inFlight, 1, "the item is in flight on the path before the extension");

    // Extend the tail downstream (a new belt at (0,2)), mid-flight.
    belts.placeBelt(0, 2, Direction.UP);

    // The item must survive the rebuild and still be delivered at the (moved) out-port.
    path = belts.pathAt(0, 5);
    let delivered = 0;
    for (let i = 0; i < 16; i += 1) {
        engine.setPortItem(path.outPort, EMPTY);
        engine.tickAll();
        if (engine.portItem(path.outPort) === RED) {
            delivered += 1;
        }
    }

    assert.equal(delivered, 1, "the in-flight item is delivered after the downstream extension");
});

// Regression: an item that has already popped and is resting in the out-port must not vanish when the
// path is extended downstream — the moved out-port would otherwise strand it in a now-internal port.
test("extending a belt path downstream preserves an item resting in the out-port", async () => {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);

    [{x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}].forEach(cell => belts.placeBelt(cell.x, cell.y, Direction.UP));

    let path = belts.pathAt(0, 5);
    // Feed one item and let it travel all the way to rest in the out-port (never drained).
    engine.setPortItem(path.inPort, RED);
    for (let i = 0; i < 10 && engine.portItem(path.outPort) !== RED; i += 1) {
        engine.tickAll();
    }
    assert.equal(engine.portItem(path.outPort), RED, "the item is resting in the out-port before the extension");

    // Extend the tail downstream, mid-rest.
    belts.placeBelt(0, 2, Direction.UP);

    path = belts.pathAt(0, 5);
    let delivered = 0;
    for (let i = 0; i < 16; i += 1) {
        engine.setPortItem(path.outPort, EMPTY);
        engine.tickAll();
        if (engine.portItem(path.outPort) === RED) {
            delivered += 1;
        }
    }

    assert.equal(delivered, 1, "the resting out-port item is delivered after the downstream extension");
});

// The client renders items against the recalculated path length and keys the resting out-port sprite by
// port id, so on a downstream extension the path-recalc must precede the item rows and the old out-port
// must be cleared — otherwise items land at a stale offset and the old sprite lingers.
test("downstream extension emits recalc before item rows and clears the old out-port", async () => {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);

    [{x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}].forEach(cell => belts.placeBelt(cell.x, cell.y, Direction.UP));
    const path = belts.pathAt(0, 5);
    const oldOutPort = path.outPort;

    engine.setPortItem(path.inPort, RED);
    for (let i = 0; i < 10 && engine.portItem(path.outPort) !== RED; i += 1) {
        engine.tickAll();
    }
    engine.drainEvents();

    belts.placeBelt(0, 2, Direction.UP);
    const events = engine.drainEvents();

    const recalcAt = events.findIndex(event => event instanceof BeltPathRecalculateEvent);
    // Re-synced items snap (BeltItemSyncEvent), not glide, since the edit didn't move them.
    const firstItemAt = events.findIndex(event => event instanceof BeltItemSyncEvent);
    assert.ok(recalcAt >= 0 && firstItemAt >= 0, "both a path recalc and item rows are emitted");
    assert.ok(recalcAt < firstItemAt, "the path recalc precedes the item rows");

    // The tail moved, so the old out-port is gone for good — its clear flushes on the next render tick.
    engine.tickAll();
    const clearedOldOut = [...events, ...engine.drainEvents()].some(event =>
        event instanceof PortItemClearEvent && event.portId === BigInt(oldOutPort));
    assert.ok(clearedOldOut, "the old out-port's resting-item sprite is cleared");
});

// The client orders item rows by id (ascending = output -> input) to place them, so after an edit the
// rebuilt run's ids must stay ascending in output->input order — otherwise a prepended output gap sorts
// as input-most and the item renders a tile too far toward the output (a visual teleport).
test("a tail extension keeps item-row ids ascending output-to-input", async () => {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);

    [{x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}].forEach(cell => belts.placeBelt(cell.x, cell.y, Direction.UP));
    const path = belts.pathAt(0, 5);
    engine.setPortItem(path.inPort, RED);
    engine.tickAll();
    engine.tickAll();

    belts.placeBelt(0, 2, Direction.UP);

    const items = belts.paths[0].items;
    const ascending = items.every((run, i) => i === 0 || items[i - 1].id < run.id);
    assert.ok(ascending, `item ids must be ascending output->input, got ${items.map(run => String(run.id))}`);
});

// A head (upstream) extension keeps the same out-port. An item resting there must stay put — the port
// survives the edit, so it must emit neither a clear nor a set (a clear+set would glide a fresh sprite
// in; a lone clear would drop it). Its sprite is left untouched.
test("extending a path upstream leaves a resting out-port item static", async () => {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);

    [{x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5}].forEach(cell => belts.placeBelt(cell.x, cell.y, Direction.UP));
    const path = belts.pathAt(0, 5);
    const outPort = path.outPort;
    engine.setPortItem(path.inPort, RED);
    for (let i = 0; i < 10 && engine.portItem(outPort) !== RED; i += 1) {
        engine.tickAll();
    }
    assert.equal(engine.portItem(outPort), RED, "the item rests in the out-port");
    engine.drainEvents();

    belts.placeBelt(0, 6, Direction.UP); // prepend upstream (head extension), out-port unchanged
    const editEvents = engine.drainEvents();
    engine.tickAll();
    const tickEvents = engine.drainEvents();

    assert.equal(engine.portItem(outPort), RED, "the item is still in the out-port after the edit");
    const churned = [...editEvents, ...tickEvents].some(event =>
        (event instanceof PortItemClearEvent || event instanceof PortItemSetEvent)
        && event.portId === BigInt(outPort));
    assert.ok(!churned, "the surviving out-port emits no clear/set, so its sprite stays static");
});
