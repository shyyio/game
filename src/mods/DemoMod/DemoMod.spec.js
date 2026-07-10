import {test} from "node:test";
import assert from "node:assert/strict";
import {setupGame} from "@/sdk/test.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";
import {createBelt, deleteBelt, GameObject} from "@/mods/Logistics/testHelpers.js";
import {
    Direction,
    BUFFERED_EVENT_TYPE_PORT_ITEM_SET,
    BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR,
} from "@/common/constants.js";
import {
    DemoMod,
    DemoMachineDefinition,
    DEMO_INPUT_ITEM_TYPE,
    DEMO_OUTPUT_ITEM_TYPE,
    DEMO_JUNK_ITEM_TYPE,
} from "@/mods/DemoMod/DemoMod.js";
import {DeleteObjectMessage, CreateObjectMessage} from "@/common/CoreMessages.js";
import {chunkId} from "@/common/util.js";

// The DemoMachine shares belt ports, so its specs boot both mods (Demo after Belt, so its
// seam ops splice into the belt pipeline).
async function setup() {
    return setupGame([new LogisticsMod(), new DemoMod()]);
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

function inject(game, portId, type=DEMO_INPUT_ITEM_TYPE) {
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

test("Does not share a port with a machine beside a ramp entrance (machine placed after)", async () => {
    const game = await setup();

    // A lone down-ramp facing UP; a machine to its left points right into the ramp's tile.
    // A ramp takes only a straight feed, so the side machine must not share the ramp's in-port.
    createBelt(game, GameObject.RAMP_DOWN, {x: 5, y: 5, direction: Direction.UP});
    createMachine(game, {x: 4, y: 5, direction: Direction.RIGHT});

    const m = machinePorts(game);
    const rampId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=5");
    const rampInPort = game.queryScalar("GetPathInPort", {id: rampId});
    assert.notEqual(Number(m.out_id), Number(rampInPort));
});

test("Does not share a port with a machine beside a ramp entrance (ramp placed after)", async () => {
    const game = await setup();

    createMachine(game, {x: 4, y: 5, direction: Direction.RIGHT});
    createBelt(game, GameObject.RAMP_DOWN, {x: 5, y: 5, direction: Direction.UP});

    const m = machinePorts(game);
    const rampId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=5");
    const rampInPort = game.queryScalar("GetPathInPort", {id: rampId});
    assert.notEqual(Number(m.out_id), Number(rampInPort));
});

test("Still shares a port with a machine feeding a ramp entrance straight from behind", async () => {
    const game = await setup();

    createBelt(game, GameObject.RAMP_DOWN, {x: 5, y: 5, direction: Direction.UP});
    createMachine(game, {x: 5, y: 6, direction: Direction.UP});

    const m = machinePorts(game);
    const rampId = game.rawScalar("SELECT id FROM Belt WHERE x=5 AND y=5");
    const rampInPort = game.queryScalar("GetPathInPort", {id: rampId});
    assert.equal(Number(m.out_id), Number(rampInPort));
});

test("Cooks its input into the recipe output two ticks later", async () => {
    const game = await setup();
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});
    const m = machinePorts(game);

    // The input is consumed the tick it lands and the processing countdown starts.
    inject(game, m.in_id);
    game.tickAll();
    assert.equal(item(game, m.in_id), null);
    assert.equal(item(game, m.out_id), null);

    // The output appears two ticks after consumption.
    game.tickAll();
    assert.equal(item(game, m.out_id), null);
    game.tickAll();
    assert.equal(item(game, m.out_id), DEMO_OUTPUT_ITEM_TYPE);
});

test("Produces the fallback Junk when the input has no recipe", async () => {
    const game = await setup();
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});
    const m = machinePorts(game);

    // An item with no Cook recipe is still consumed, but yields the verb's fallback output.
    inject(game, m.in_id, DEMO_INPUT_ITEM_TYPE + 50);
    for (let i = 0; i < 4; i += 1) {
        game.tickAll();
    }
    assert.equal(item(game, m.in_id), null);
    assert.equal(item(game, m.out_id), DEMO_JUNK_ITEM_TYPE);
});

test("Consumes the next input the same tick it produces an output (pipelining)", async () => {
    const game = await setup();
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});
    const m = machinePorts(game);

    // Keep the in-port fed and drain the output each tick; the tick an output is created the next
    // input is consumed in step, so an upstream belt shifts forward exactly then.
    let producedOnce = false;
    let consumedOnProduction = false;
    for (let i = 0; i < 12; i += 1) {
        inject(game, m.in_id);
        game.rawExec(`UPDATE Port SET item=NULL WHERE id=${m.out_id}`);
        game.tickAll();
        if (item(game, m.out_id) === DEMO_OUTPUT_ITEM_TYPE) {
            producedOnce = true;
            if (item(game, m.in_id) === null) {
                consumedOnProduction = true;
            }
        }
    }
    assert.ok(producedOnce);
    assert.ok(consumedOnProduction);
});

test("Stalls with the next input held when the output is blocked (backpressure)", async () => {
    const game = await setup();
    createMachine(game, {x: 5, y: 5, direction: Direction.UP});
    const m = machinePorts(game);

    // Occupy the output with no downstream to drain it, run a batch, then leave another input waiting.
    inject(game, m.out_id, DEMO_OUTPUT_ITEM_TYPE);
    inject(game, m.in_id);
    for (let i = 0; i < 4; i += 1) {
        game.tickAll();
    }
    inject(game, m.in_id);
    for (let i = 0; i < 4; i += 1) {
        game.tickAll();
    }

    // The create can't resolve, so the machine never finishes and the waiting input is untouched.
    assert.equal(item(game, m.in_id), DEMO_INPUT_ITEM_TYPE);
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
    for (let i = 0; i < 40; i += 1) {
        if (i < 10) {
            inject(game, feederInPort);
        }
        game.tickAll();
    }

    // The cooked output rode onto the downstream belt; the raw input never passed through as itself.
    assert.ok(game.rawScalar(`SELECT COUNT(*) FROM BeltPathItem WHERE path_id=${drainPath} AND type=${DEMO_OUTPUT_ITEM_TYPE}`) > 0);
    assert.equal(game.rawScalar(`SELECT COUNT(*) FROM BeltPathItem WHERE path_id=${drainPath} AND type=${DEMO_INPUT_ITEM_TYPE}`), 0);
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
