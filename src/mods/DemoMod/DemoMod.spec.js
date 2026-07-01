import {test} from "node:test";
import assert from "node:assert/strict";
import {setupGame} from "@/sdk/test.js";
import {BeltMod} from "@/mods/Belt/mod.js";
import {createBelt, deleteBelt, GameObject} from "@/mods/Belt/testHelpers.js";
import {
    Direction,
    BUFFERED_EVENT_TYPE_PORT_ITEM_SET,
    BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR,
} from "@/common/constants.js";
import {DemoMod, DemoMachineDefinition, DEMO_OUTPUT_ITEM_TYPE} from "@/mods/DemoMod/DemoMod.js";
import {DeleteObjectMessage, CreateObjectMessage} from "@/common/CoreMessages.js";
import {chunkId} from "@/common/util.js";

// The DemoMachine shares belt ports, so its specs boot both mods (Demo after Belt, so its
// seam ops splice into the belt pipeline).
async function setup() {
    return setupGame([new BeltMod(), new DemoMod()]);
}

function createMachine(game, options) {
    game.dispatchMessage(new CreateObjectMessage(DemoMachineDefinition.typeId, options.x, options.y, options.direction));
}

function deleteMachine(game, id) {
    game.dispatchMessage(new DeleteObjectMessage(id));
}

function machinePorts(game) {
    const id = game.rawScalar("SELECT id FROM DemoMachine LIMIT 1");
    return {
        id,
        in_id: game.rawScalar(`SELECT in_id FROM DemoMachine WHERE id=${id}`),
        out_id: game.rawScalar(`SELECT out_id FROM DemoMachine WHERE id=${id}`),
    };
}

function inject(game, portId, type=7) {
    game.rawExec(`UPDATE Port SET item=${type} WHERE id=${portId}`);
}

function item(game, portId) {
    return game.rawScalar(`SELECT item FROM Port WHERE id=${portId}`);
}

test("Wires a machine to two distinct ports", async () => {
    const game = await setup();

    createMachine(game, {x: 5, y: 5, direction: Direction.UP});

    const m = machinePorts(game);
    assert.notEqual(m.in_id, null);
    assert.notEqual(m.out_id, null);
    assert.notEqual(Number(m.in_id), Number(m.out_id));
});

test("Shares ports with the belts it sits between", async () => {
    const game = await setup();

    // Feeder belt below (flows up into the machine); drain belt above the machine.
    createBelt(game, GameObject.BELT, {x: 5, y: 6, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 5, y: 4, direction: Direction.UP});
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});

    const m = machinePorts(game);
    const feederId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=6");
    const drainId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=4");

    assert.equal(Number(m.in_id), Number(game.queryScalar("GetPathOutPort", {id: feederId})));
    assert.equal(Number(m.out_id), Number(game.queryScalar("GetPathInPort", {id: drainId})));
});

test("Adopts the belts' ports when they are placed around it afterwards", async () => {
    const game = await setup();

    createMachine(game, {x: 5, y: 5, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 5, y: 6, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 5, y: 4, direction: Direction.UP});

    const m = machinePorts(game);
    const feederId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=6");
    const drainId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=4");

    assert.equal(Number(game.queryScalar("GetPathOutPort", {id: feederId})), Number(m.in_id));
    assert.equal(Number(game.queryScalar("GetPathInPort", {id: drainId})), Number(m.out_id));
});

test("Creates one output two ticks after the second input is consumed", async () => {
    const game = await setup();
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});
    const m = machinePorts(game);

    // First input is consumed and counted; one input alone never produces.
    inject(game, m.in_id, 7);
    game.tickAll();
    assert.equal(item(game, m.in_id), null);
    assert.equal(item(game, m.out_id), null);

    // Second input completes the recipe and starts the cooldown.
    inject(game, m.in_id, 7);
    game.tickAll();
    assert.equal(item(game, m.out_id), null);

    // The output appears two ticks later.
    game.tickAll();
    assert.equal(item(game, m.out_id), null);
    game.tickAll();
    assert.equal(item(game, m.out_id), DEMO_OUTPUT_ITEM_TYPE);
});

test("Needs two inputs per output (2:1)", async () => {
    const game = await setup();
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});
    const m = machinePorts(game);

    // One input is consumed but never produces on its own.
    inject(game, m.in_id, 7);
    for (let i = 0; i < 5; i += 1) {
        game.tickAll();
    }
    assert.equal(item(game, m.out_id), null);

    // The second input completes the recipe and an output appears.
    inject(game, m.in_id, 7);
    for (let i = 0; i < 5; i += 1) {
        game.tickAll();
    }
    assert.equal(item(game, m.out_id), DEMO_OUTPUT_ITEM_TYPE);
});

test("Consumes the next input the same tick it produces an output", async () => {
    const game = await setup();
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});
    const m = machinePorts(game);

    // Keep the in-port fed and drain the output each tick; on every tick an output is created the
    // waiting input is consumed too, so an upstream belt shifts forward exactly when the output appears.
    let producedOnce = false;
    for (let i = 0; i < 12; i += 1) {
        inject(game, m.in_id, 7);
        game.rawExec(`UPDATE Port SET item=NULL WHERE id=${m.out_id}`);
        game.tickAll();
        if (item(game, m.out_id) === DEMO_OUTPUT_ITEM_TYPE) {
            assert.equal(item(game, m.in_id), null);
            producedOnce = true;
        }
    }
    assert.ok(producedOnce);
});

test("Stalls with the next input held when the output is blocked (backpressure)", async () => {
    const game = await setup();
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});
    const m = machinePorts(game);

    // Occupy the output with no downstream to drain it, run a full recipe, then leave a third input.
    inject(game, m.out_id, DEMO_OUTPUT_ITEM_TYPE);
    inject(game, m.in_id, 7);
    game.tickAll();
    inject(game, m.in_id, 7);
    game.tickAll();
    inject(game, m.in_id, 7);
    for (let i = 0; i < 5; i += 1) {
        game.tickAll();
    }

    // The create can't resolve, so the recipe never resets and the third input is left untouched.
    assert.equal(item(game, m.in_id), 7);
    assert.equal(item(game, m.out_id), DEMO_OUTPUT_ITEM_TYPE);
});

test("Flows created output onto a downstream belt end to end", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 5, y: 6, direction: Direction.UP});
    createBelt(game, GameObject.BELT, {x: 5, y: 4, direction: Direction.UP});
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});

    const feederId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=6");
    const drainPath = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=4");
    const feederInPort = game.queryScalar("GetPathInPort", {id: feederId});

    // Feed the upstream belt for a while, then let the line drain.
    for (let i = 0; i < 30; i += 1) {
        if (i < 10) {
            inject(game, feederInPort, 7);
        }
        game.tickAll();
    }

    // The created output type rode onto the downstream belt; the consumed input type never did.
    assert.ok(game.rawScalar(`SELECT COUNT(*) FROM BeltPathItem WHERE path_id=${drainPath} AND type=${DEMO_OUTPUT_ITEM_TYPE}`) > 0);
    assert.equal(game.rawScalar(`SELECT COUNT(*) FROM BeltPathItem WHERE type=7`), 0);
});

test("Emits out-port item deltas for a watched machine output", async () => {
    const game = await setup();
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});
    const m = machinePorts(game);
    // Rest an item in the output; with no downstream belt it stays put for the capture.
    inject(game, m.out_id, DEMO_OUTPUT_ITEM_TYPE);
    game.rawExec(`INSERT INTO SessionViewport (session_id, chunk) VALUES (1, ${chunkId(0, 0)})`);

    game.tickAll();
    assert.equal(
        game.rawScalar(`SELECT a FROM BufferedEvent WHERE type=${BUFFERED_EVENT_TYPE_PORT_ITEM_SET} AND id=${m.out_id}`),
        DEMO_OUTPUT_ITEM_TYPE,
    );

    // Item leaves the port: a CLEAR.
    game.rawExec("DELETE FROM BufferedEvent");
    game.rawExec(`UPDATE Port SET item=NULL WHERE id=${m.out_id}`);
    game.tickAll();
    assert.equal(
        game.rawScalar(`SELECT COUNT(*) FROM BufferedEvent WHERE type=${BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR} AND id=${m.out_id}`),
        1,
    );
});

test("Rejects a machine on an occupied tile", async () => {
    const game = await setup();

    createBelt(game, GameObject.BELT, {x: 5, y: 5, direction: Direction.UP});
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM DemoMachine"), 0);
});

test("Removal drops an unshared port but keeps one a belt still shares", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 5, y: 6, direction: Direction.UP});
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});
    const m = machinePorts(game);

    deleteMachine(game, m.id);

    assert.equal(game.rawScalar("SELECT COUNT(*) FROM DemoMachine"), 0);
    // The in-port is shared with the feeder belt's out-port, so it survives.
    assert.equal(game.rawScalar(`SELECT COUNT(*) FROM Port WHERE id=${Number(m.in_id)}`), 1);
    // The out-port had no downstream, so it's dropped.
    assert.equal(game.rawScalar(`SELECT COUNT(*) FROM Port WHERE id=${Number(m.out_id)}`), 0);
});

test("Deleting a connected belt keeps the port the machine still shares", async () => {
    const game = await setup();
    createBelt(game, GameObject.BELT, {x: 5, y: 6, direction: Direction.UP});
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});
    const m = machinePorts(game);
    const feederId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=6");

    deleteBelt(game, feederId);

    // Generic port GC sees the machine still referencing the shared port, so it survives and
    // the machine keeps its in-port — a later belt re-adopts it.
    assert.equal(game.rawScalar("SELECT COUNT(*) FROM Belt"), 0);
    assert.equal(game.rawScalar(`SELECT COUNT(*) FROM Port WHERE id=${Number(m.in_id)}`), 1);
    assert.equal(game.rawScalar("SELECT in_id FROM DemoMachine"), Number(m.in_id));
});
