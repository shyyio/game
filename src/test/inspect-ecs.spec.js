import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/common/Game.js";
import {Direction} from "@/common/constants.js";
import {DemoMachineType, ITEM_TYPE_DEMO_INPUT, ITEM_TYPE_DEMO_OUTPUT} from "@/mods/Demo/declaration.js";
import {SetInspectedObjectsMessage, DeleteObjectMessage, CreateObjectMessage} from "@/common/CoreMessages.js";
import {InspectHeartbeatEvent, InspectClosedEvent} from "@/common/InspectEvents.js";
import {GameEngine, TICK_PHASE_ORDER} from "@/common/sim/GameEngine.js";
import {ecsModRegistry} from "@/test/ecsSim.js";

class CapturingSession {

    constructor(playerId) {
        this.playerId = playerId;
        this.id = null;
        this.events = [];
    }

    setId(id) {
        this.id = id;
    }

    publishEvent(event) {
        this.events.push(event);
    }
}

async function setup() {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry));
    await game.init();
    return game;
}

// Places a DemoMachine and returns its client id (object id) plus its input port.
function createMachine(game, x, y) {
    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, x, y, Direction.UP), null);
    const placed = game.simEngine.placed;
    const eids = placed.eidsOf(DemoMachineType.typeId);
    const eid = eids[eids.length - 1];
    const machine = game.simEngine.component("Machine").store;
    return {id: placed.PlacedObject.clientId[eid], inPort: machine.in0[eid]};
}

function heartbeats(session) {
    return session.events.filter(event => event instanceof InspectHeartbeatEvent);
}

test("opening a menu syncs the machine snapshot immediately, without a tick", async () => {
    const game = await setup();
    const machine = createMachine(game, 5, 5);
    const session = new CapturingSession(1);
    game.connect(session);

    game.dispatchMessage(new SetInspectedObjectsMessage([machine.id]), session);

    const synced = heartbeats(session);
    assert.equal(synced.length, 1);
    const snapshot = synced[0];
    assert.equal(snapshot.objectId, machine.id);
    assert.deepEqual(snapshot.inputPorts, [0]);
    assert.deepEqual(snapshot.inputMemory, [0]);
    assert.equal(snapshot.processingRemaining, null);
    assert.equal(snapshot.processingTotal, 2);
    assert.equal(snapshot.outputItem, null);
    assert.equal(snapshot.recipeOutput, null);
});

test("emits a heartbeat snapshot each tick to a subscribing session", async () => {
    const game = await setup();
    const machine = createMachine(game, 5, 5);
    const session = new CapturingSession(1);
    game.connect(session);

    game.dispatchMessage(new SetInspectedObjectsMessage([machine.id]), session);
    session.events.length = 0;
    TICK_PHASE_ORDER.forEach(phase => game.tick(phase));
    game.postTick();

    assert.equal(heartbeats(session).length, 1);
    assert.equal(heartbeats(session)[0].objectId, machine.id);
});

test("each inspecting session gets its own heartbeat for a shared machine", async () => {
    const game = await setup();
    const machine = createMachine(game, 5, 5);
    const a = new CapturingSession(1);
    const b = new CapturingSession(2);
    game.connect(a);
    game.connect(b);

    game.dispatchMessage(new SetInspectedObjectsMessage([machine.id]), a);
    game.dispatchMessage(new SetInspectedObjectsMessage([machine.id]), b);
    a.events.length = 0;
    b.events.length = 0;
    TICK_PHASE_ORDER.forEach(phase => game.tick(phase));
    game.postTick();

    assert.equal(heartbeats(a).length, 1);
    assert.equal(heartbeats(b).length, 1);
});

test("heartbeat tracks the processing countdown, consumed batch, and output", async () => {
    const game = await setup();
    const machine = createMachine(game, 5, 5);
    const session = new CapturingSession(1);
    game.connect(session);
    game.dispatchMessage(new SetInspectedObjectsMessage([machine.id]), session);

    const tick = () => {
        session.events.length = 0;
        TICK_PHASE_ORDER.forEach(phase => game.tick(phase));
        game.postTick();
        return heartbeats(session)[0];
    };

    game.simEngine.setPortItem(machine.inPort, ITEM_TYPE_DEMO_INPUT);
    const started = tick();
    assert.equal(started.processingRemaining, 2);
    assert.deepEqual(started.inputMemory, [ITEM_TYPE_DEMO_INPUT]);
    assert.equal(started.recipeOutput, ITEM_TYPE_DEMO_OUTPUT);

    const midway = tick();
    assert.equal(midway.processingRemaining, 1);
    assert.deepEqual(midway.inputMemory, [ITEM_TYPE_DEMO_INPUT]);

    const done = tick();
    assert.equal(done.processingRemaining, null);
    assert.deepEqual(done.inputMemory, [0]);
    assert.equal(done.outputItem, ITEM_TYPE_DEMO_OUTPUT);
});

test("unsubscribing stops the heartbeats", async () => {
    const game = await setup();
    const machine = createMachine(game, 5, 5);
    const session = new CapturingSession(1);
    game.connect(session);

    game.dispatchMessage(new SetInspectedObjectsMessage([machine.id]), session);
    game.dispatchMessage(new SetInspectedObjectsMessage([]), session);
    session.events.length = 0;
    TICK_PHASE_ORDER.forEach(phase => game.tick(phase));
    game.postTick();

    assert.equal(heartbeats(session).length, 0);
});

test("a session inspects several machines at once", async () => {
    const game = await setup();
    const a = createMachine(game, 5, 5);
    const b = createMachine(game, 8, 8);
    const session = new CapturingSession(1);
    game.connect(session);

    game.dispatchMessage(new SetInspectedObjectsMessage([a.id, b.id]), session);

    const ids = heartbeats(session).map(event => event.objectId).sort();
    assert.deepEqual(ids, [a.id, b.id].sort());
});

test("deleting an inspected machine closes its menu and stops heartbeats", async () => {
    const game = await setup();
    const machine = createMachine(game, 5, 5);
    const session = new CapturingSession(1);
    game.connect(session);
    game.dispatchMessage(new SetInspectedObjectsMessage([machine.id]), session);

    game.dispatchMessage(new DeleteObjectMessage(machine.id), session);

    const closed = session.events.filter(event => event instanceof InspectClosedEvent);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].objectId, machine.id);

    session.events.length = 0;
    TICK_PHASE_ORDER.forEach(phase => game.tick(phase));
    game.postTick();
    assert.equal(heartbeats(session).length, 0);
});
