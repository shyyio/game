
import {test} from "node:test";
import assert from "node:assert/strict";
import {setup} from "@/test/common.js";
import {GameObject, createBelt, createSplitter} from "./testHelpers.js";
import {
    Direction,
    OCCUPANCY_LAYER_SURFACE,
    BUFFERED_EVENT_TYPE_PORT_ITEM_SET,
    BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR,
} from "@/common/constants.js";
import {OCCUPANCY_LAYER_UNDERGROUND_BASE} from "./constants.js";
import {chunkId} from "@/common/util.js";

// The lone splitter's port row (in/out/internal port ids + state).
function splitterPorts(game) {
    const id = game.rawScalar("SELECT id FROM Splitter LIMIT 1");
    const col = (name) => game.rawScalar(`SELECT ${name} FROM Splitter WHERE id=${id}`);
    return {
        in_a_id: col("in_a_id"),
        in_b_id: col("in_b_id"),
        out_a_id: col("out_a_id"),
        out_b_id: col("out_b_id"),
        int_a_id: col("int_a_id"),
        int_b_id: col("int_b_id"),
        state: col("state"),
    };
}

function inject(game, portId) {
    game.rawExec(`UPDATE Port SET item=1 WHERE id=${portId}`);
}

function clear(game, portId) {
    game.rawExec(`UPDATE Port SET item=NULL WHERE id=${portId}`);
}

function item(game, portId) {
    return game.rawScalar(`SELECT item FROM Port WHERE id=${portId}`);
}

test("Creates a splitter wired to six distinct ports", async () => {
    const game = await setup();

    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});

    const s = splitterPorts(game);
    const ids = [
        s.in_a_id, s.in_b_id,
        s.out_a_id, s.out_b_id,
        s.int_a_id, s.int_b_id,
    ];
    ids.forEach(id => assert.notEqual(id, null));
    assert.equal(new Set(ids.map(Number)).size, 6);
    assert.equal(s.state, 0);
});

test("Merges a belt into one fed by a splitter without dropping the shared port", async () => {
    const game = await setup();
    createSplitter(game, {x: 12, y: 6, direction: Direction.UP});
    // This belt adopts the splitter's out_port_b as its in-port (the splitter feeds it).
    createBelt(game, GameObject.BELT, {x: 13, y: 5, direction: Direction.UP});
    const sharedPort = game.rawScalar("SELECT out_b_id FROM Splitter");

    // A belt feeding that belt from the left merges the two into one path. The merge must not
    // delete the shared in-port (still owned by the splitter) — doing so broke its foreign key.
    createBelt(game, GameObject.BELT, {x: 12, y: 5, direction: Direction.RIGHT});

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 2);
    assert.equal(game.rawScalar("SELECT COUNT(DISTINCT path_id) FROM Belt"), 1);
    // The splitter still owns the shared port.
    assert.equal(game.rawScalar("SELECT out_b_id FROM Splitter"), Number(sharedPort));
    assert.equal(game.rawScalar(`SELECT COUNT(*) FROM Port WHERE id=${Number(sharedPort)}`), 1);
});

test("Emits out-port item deltas for a watched splitter output", async () => {
    const game = await setup();
    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});
    const s = splitterPorts(game);
    // Rest an item in output A; with no downstream belt it stays put for the capture.
    inject(game, s.out_a_id);
    game.rawExec(`INSERT INTO SessionViewport (session_id, chunk) VALUES (1, ${chunkId(0, 0)})`);

    game.tickAll();
    assert.equal(
        game.rawScalar(`SELECT a FROM BufferedEvent WHERE type=${BUFFERED_EVENT_TYPE_PORT_ITEM_SET} AND id=${s.out_a_id}`),
        1,
    );

    // Item leaves the port: a CLEAR.
    game.rawExec("DELETE FROM BufferedEvent");
    clear(game, s.out_a_id);
    game.tickAll();
    assert.equal(
        game.rawScalar(`SELECT COUNT(*) FROM BufferedEvent WHERE type=${BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR} AND id=${s.out_a_id}`),
        1,
    );
});

test("Rejects a splitter overlapping an existing one", async () => {
    const game = await setup();

    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});
    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Splitter"), 1);
});

test("A belt path extended onto a splitter input adopts the shared port (placement order)", async () => {
    const game = await setup();
    // Splitter facing up; its in_B sits at the far cell (14,4), fed from (14,5).
    createSplitter(game, {x: 13, y: 4, direction: Direction.UP});
    // Place the upstream belt first, then the tail belt that turns up into in_B — so the tail
    // is added to an already-built path. The path's out-port must still adopt in_B.
    createBelt(game, GameObject.BELT, {x: 15, y: 5, direction: Direction.LEFT});
    createBelt(game, GameObject.BELT, {x: 14, y: 5, direction: Direction.UP});

    const inB = game.rawScalar("SELECT in_b_id FROM Splitter");
    assert.equal(game.rawScalar("SELECT out_port_id FROM BeltPath"), Number(inB));
});

test("Rejects a splitter whose far geometry tile overlaps a belt", async () => {
    const game = await setup();

    // A belt on the splitter's second tile (6,5); its base tile (5,5) is clear. The engine's
    // geometry collision must still reject it — the old per-tile unique index never saw the far cell.
    createBelt(game, GameObject.BELT, {x: 6, y: 5, direction: Direction.UP});
    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Splitter"), 0);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 1);
});

test("IsOccupied reports a belt on the surface layer only", async () => {
    const game = await setup();

    createBelt(game, GameObject.BELT, {x: 5, y: 5, direction: Direction.UP});

    assert.notEqual(game.queryScalar("IsOccupied", {x: 5, y: 5, layer: OCCUPANCY_LAYER_SURFACE}), null);
    // The underground axis layers stay free, so a tunnel could still pass under the belt.
    assert.equal(game.queryScalar("IsOccupied", {x: 5, y: 5, layer: OCCUPANCY_LAYER_UNDERGROUND_BASE}), null);
    assert.equal(game.queryScalar("IsOccupied", {x: 5, y: 5, layer: OCCUPANCY_LAYER_UNDERGROUND_BASE + 1}), null);
});

test("Shares ports with the belts it sits between", async () => {
    const game = await setup();

    // Feeder belt below in_A (flows up into the splitter); drain belt above out_A.
    createBelt(game, GameObject.BELT, {x: 5, y: 6, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 5, y: 4, direction: Direction.UP});
    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});

    const s = splitterPorts(game);
    const feederId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=6");
    const drainId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=4");

    assert.equal(Number(s.in_a_id), Number(game.queryScalar("GetPathOutPort", {id: feederId})));
    assert.equal(Number(s.out_a_id), Number(game.queryScalar("GetPathInPort", {id: drainId})));
});

test("Adopts a splitter's ports when belts are placed around it afterwards", async () => {
    const game = await setup();

    // Splitter first, then a feeder belt below in_A and a drain belt above out_A: the
    // belts must attach to the splitter's existing ports, not mint fresh ones.
    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 5, y: 6, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 5, y: 4, direction: Direction.UP});

    const s = splitterPorts(game);
    const feederId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=6");
    const drainId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=4");

    assert.equal(Number(game.queryScalar("GetPathOutPort", {id: feederId})), Number(s.in_a_id));
    assert.equal(Number(game.queryScalar("GetPathInPort", {id: drainId})), Number(s.out_a_id));
});

test("Takes three ticks to cross (input, internal, output) — no teleport", async () => {
    const game = await setup();
    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});
    const s = splitterPorts(game);

    inject(game, s.in_a_id);

    // After one tick the item has only reached the internal buffer, not an output.
    game.tickAll();
    assert.notEqual(item(game, s.int_a_id), null);
    assert.equal(item(game, s.out_a_id), null);
    assert.equal(item(game, s.out_b_id), null);

    // The next tick routes it to an output.
    game.tickAll();
    assert.equal(item(game, s.int_a_id), null);
    assert.notEqual(item(game, s.out_a_id), null);
});

test("Round-robins a single lane across both outputs", async () => {
    const game = await setup();
    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});
    const s = splitterPorts(game);

    const out = [];
    for (let i = 0; i < 4; i += 1) {
        clear(game, s.out_a_id);
        clear(game, s.out_b_id);
        inject(game, s.int_a_id);

        game.tickAll();

        out.push(item(game, s.out_a_id) !== null ? "A" : (item(game, s.out_b_id) !== null ? "B" : "-"));
    }

    assert.deepEqual(out, ["A", "B", "A", "B"]);
});

test("Saturates both outputs when both lanes are saturated", async () => {
    const game = await setup();
    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});
    const s = splitterPorts(game);

    for (let i = 0; i < 4; i += 1) {
        clear(game, s.out_a_id);
        clear(game, s.out_b_id);
        inject(game, s.int_a_id);
        inject(game, s.int_b_id);

        game.tickAll();

        // Each lane routes to a different output every tick, so both stay filled.
        assert.notEqual(item(game, s.out_a_id), null);
        assert.notEqual(item(game, s.out_b_id), null);
    }
});

test("Carries a real belt item from a feeder belt through to a drain belt", async () => {
    const game = await setup();

    // feeder belt -> splitter in_A; splitter out_A -> drain belt. Splitter placed last so
    // it adopts the belts' shared ports.
    createBelt(game, GameObject.BELT, {x: 5, y: 6, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 5, y: 4, direction: Direction.UP});
    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});

    const feederId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=6");
    const drainId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=4");
    const feederIn = game.queryScalar("GetPathInPort", {id: feederId});
    const drainOut = game.queryScalar("GetPathOutPort", {id: drainId});

    // Drop one item onto the feeder belt's input edge and let it travel the whole chain.
    inject(game, feederIn);

    let arrived = false;
    for (let i = 0; i < 30 && !arrived; i += 1) {
        game.tickAll();
        arrived = item(game, drainOut) !== null;
    }

    assert.ok(arrived, "item reached the drain belt's output");
    // The item is conserved — exactly one in the whole system.
    const items = game.rawScalar("SELECT COUNT(*) FROM Port WHERE item IS NOT NULL")
        + game.rawScalar("SELECT COUNT(*) FROM BeltPathItem WHERE type != 0");
    assert.equal(items, 1);
});

test("Back-pressures a feeder when both outputs are blocked, losing no items", async () => {
    const game = await setup();

    // Feeder belt -> splitter in_A; both splitter outputs have no downstream, so they
    // block once filled. A correctly-mapped input port stops draining, backing the feeder up.
    createBelt(game, GameObject.BELT, {x: 5, y: 6, direction: Direction.UP});
    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});

    const feederId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=6");
    const feederIn = game.queryScalar("GetPathInPort", {id: feederId});

    // A saturated source: drop an item whenever the feeder's input edge is free.
    let injected = 0;
    for (let i = 0; i < 40; i += 1) {
        if (item(game, feederIn) === null) {
            inject(game, feederIn);
            injected += 1;
        }
        game.tickAll();
    }

    // Every item is still somewhere in the system — none silently overwritten because the
    // resolver wrongly thought an occupied input port was available.
    const count = game.rawScalar("SELECT COUNT(*) FROM Port WHERE item IS NOT NULL")
        + game.rawScalar("SELECT COUNT(*) FROM BeltPathItem WHERE type != 0");
    assert.equal(count, injected);
    // And the feeder did stop accepting (back-pressure reached its input edge).
    assert.notEqual(item(game, feederIn), null);
});

test("Routes into a downstream that ingests into head room without popping", async () => {
    const game = await setup();

    // A long empty belt above out_A: it has head room, so it ingests the item resting in
    // out_A this tick without popping its own lead — a drain no transfer represents.
    createBelt(game, GameObject.BELT, {x: 5, y: 4, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 5, y: 3, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 5, y: 2, direction: Direction.UP});
    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});
    const s = splitterPorts(game);

    // out_A holds a resting item the belt will ingest; out_B is blocked; int_A is loaded.
    inject(game, s.out_a_id);
    inject(game, s.out_b_id);
    inject(game, s.int_a_id);

    game.tickAll();

    // The belt ingested out_A's item (now in the path) AND the splitter refilled out_A the
    // same tick — only possible because the belt declared its in-port drainable this tick.
    assert.notEqual(item(game, s.out_a_id), null);
    assert.equal(item(game, s.int_a_id), null);
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM BeltPathItem WHERE type != 0"), 1);
});

test("Routes around a blocked output at full throughput", async () => {
    const game = await setup();
    createSplitter(game, {x: 5, y: 5, direction: Direction.UP});
    const s = splitterPorts(game);

    // out_A is permanently blocked (an item that never drains, no downstream).
    inject(game, s.out_a_id);

    let delivered = 0;
    for (let i = 0; i < 4; i += 1) {
        clear(game, s.out_b_id);
        inject(game, s.int_a_id);

        game.tickAll();

        if (item(game, s.out_b_id) !== null) {
            delivered += 1;
        }
        // The blocked output is never written.
        assert.notEqual(item(game, s.out_a_id), null);
    }

    assert.equal(delivered, 4);
});
