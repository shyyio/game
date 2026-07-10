import {test} from "node:test";
import assert from "node:assert/strict";
import {setupGame, TickPhase} from "@/sdk/test.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";
import {Direction} from "@/common/constants.js";
import {
    DemoMod,
    DemoMachineDefinition,
    DEMO_INPUT_ITEM_TYPE,
    DEMO_OUTPUT_ITEM_TYPE,
} from "@/mods/DemoMod/DemoMod.js";
import {SetInspectedObjectsMessage, DeleteObjectMessage, CreateObjectMessage} from "@/common/CoreMessages.js";
import {InspectHeartbeatEvent, InspectClosedEvent} from "@/common/InspectEvents.js";

async function setup() {
    return setupGame([new LogisticsMod(), new DemoMod()]);
}

function createMachine(game, x, y) {
    game.dispatchMessage(new CreateObjectMessage(DemoMachineDefinition.typeId, x, y, Direction.UP));
    const id = game.rawScalar(`SELECT id FROM DemoMachine WHERE x=${x} AND y=${y}`);
    return {
        id,
        in_id: game.rawScalar(`SELECT in_id FROM DemoMachine WHERE id=${id}`),
        out_id: game.rawScalar(`SELECT out_id FROM DemoMachine WHERE id=${id}`),
    };
}

// Captures the events delivered to the session (round-tripped through the wire codec in dev).
function capture(game) {
    const events = [];
    game.session.client = {publishEvent: (event) => events.push(event)};
    return events;
}

function heartbeatEvents(events) {
    return events.filter(event => event instanceof InspectHeartbeatEvent);
}

function inject(game, portId) {
    game.rawExec(`UPDATE Port SET item=${DEMO_INPUT_ITEM_TYPE} WHERE id=${portId}`);
}

test("Opening a menu syncs the machine snapshot immediately, without a tick", async () => {
    const game = await setup();
    const machine = createMachine(game, 5, 5);
    const events = capture(game);

    game.dispatchMessage(new SetInspectedObjectsMessage([machine.id]));

    const synced = heartbeatEvents(events);
    assert.equal(synced.length, 1);
    const snapshot = synced[0];
    assert.equal(Number(snapshot.objectId), Number(machine.id));
    assert.deepEqual(snapshot.inputPorts, [0]); // one input port, empty
    assert.deepEqual(snapshot.inputMemory, [0]); // nothing gathered yet
    assert.equal(snapshot.processingRemaining, null);
    assert.equal(snapshot.processingTotal, 2);
    assert.equal(snapshot.outputItem, null);
    assert.equal(snapshot.recipeOutput, null); // nothing gathered, so no inference
});

test("Emits a heartbeat snapshot each tick to a subscribing session", async () => {
    const game = await setup();
    const machine = createMachine(game, 5, 5);
    const events = capture(game);

    game.dispatchMessage(new SetInspectedObjectsMessage([machine.id]));
    events.length = 0;
    game.tickAll();
    game.game.postTick();

    assert.equal(heartbeatEvents(events).length, 1);
    assert.equal(Number(heartbeatEvents(events)[0].objectId), Number(machine.id));
});

test("Heartbeat snapshots a machine once even when two sessions inspect it", async () => {
    const game = await setup();
    const machine = createMachine(game, 5, 5);
    game.dispatchMessage(new SetInspectedObjectsMessage([machine.id]));
    // A second session inspecting the same machine — DISTINCT must collapse it to one snapshot row.
    game.rawExec("INSERT INTO Session (id, player_id) VALUES (999, 1)");
    game.rawExec(`INSERT INTO SessionInspect (session_id, object_id) VALUES (999, ${machine.id})`);

    game.tick(TickPhase.EMIT_INSPECT);

    assert.equal(Number(game.rawScalar("SELECT COUNT(*) FROM BufferedInspectHeartbeatEvent")), 1);
});

test("Heartbeat tracks processing countdown and output", async () => {
    const game = await setup();
    const machine = createMachine(game, 5, 5);
    const events = capture(game);
    game.dispatchMessage(new SetInspectedObjectsMessage([machine.id]));

    const tick = () => {
        events.length = 0;
        game.tickAll();
        game.game.postTick();
        return heartbeatEvents(events)[0];
    };

    inject(game, machine.in_id);
    const started = tick();
    assert.equal(started.processingRemaining, 2); // consumed this tick, processing started
    assert.deepEqual(started.inputMemory, [DEMO_INPUT_ITEM_TYPE]); // consumed batch visible while processing
    assert.equal(started.recipeOutput, DEMO_OUTPUT_ITEM_TYPE); // inferred from the gathered batch

    const midway = tick();
    assert.equal(midway.processingRemaining, 1);
    assert.deepEqual(midway.inputMemory, [DEMO_INPUT_ITEM_TYPE]);

    const done = tick();
    assert.equal(done.processingRemaining, null);
    assert.deepEqual(done.inputMemory, [0]); // batch cleared when the output is produced
    assert.equal(done.outputItem, DEMO_OUTPUT_ITEM_TYPE);
});

test("Unsubscribing stops the heartbeats", async () => {
    const game = await setup();
    const machine = createMachine(game, 5, 5);
    const events = capture(game);

    game.dispatchMessage(new SetInspectedObjectsMessage([machine.id]));
    game.dispatchMessage(new SetInspectedObjectsMessage([]));
    events.length = 0;
    game.tickAll();
    game.game.postTick();

    assert.equal(heartbeatEvents(events).length, 0);
});

test("A session inspects several machines at once", async () => {
    const game = await setup();
    const a = createMachine(game, 5, 5);
    const b = createMachine(game, 8, 8);
    const events = capture(game);

    game.dispatchMessage(new SetInspectedObjectsMessage([a.id, b.id]));

    const ids = heartbeatEvents(events).map(event => Number(event.objectId)).sort();
    assert.deepEqual(ids, [Number(a.id), Number(b.id)].sort());
});

test("Deleting an inspected machine closes its menu and stops heartbeats", async () => {
    const game = await setup();
    const machine = createMachine(game, 5, 5);
    const events = capture(game);
    game.dispatchMessage(new SetInspectedObjectsMessage([machine.id]));

    game.dispatchMessage(new DeleteObjectMessage(machine.id));

    const closed = events.filter(event => event instanceof InspectClosedEvent);
    assert.equal(closed.length, 1);
    assert.equal(Number(closed[0].objectId), Number(machine.id));

    events.length = 0;
    game.tickAll();
    game.game.postTick();
    assert.equal(heartbeatEvents(events).length, 0);
});
