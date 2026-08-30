import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent} from "@/common/ObjectEvents.js";
import {WorkerAssignmentEvent, NO_HOUSING} from "@/common/WorkerEvents.js";
import {ModPackage} from "@/common/ModPackage.js";
import {
    TestMachineType,
    ITEM_TYPE_TEST_MACHINE_INPUT,
    ITEM_TYPE_TEST_MACHINE_OUTPUT,
    TEST_MACHINE_WORKER_COST,
    MachineFixtureDeclaration,
} from "@/test/machineFixture.js";
import {RoadDefinition, HousingDefinition} from "@/mods/Logistics/common/objectTypes.js";
import {HOUSING_WORKER_SUPPLY} from "@/mods/Logistics/common/constants.js";
import {EMPTY} from "@/sim/sentinels.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {EventCollector, flattenBatches} from "@/test/EventCollector.js";

/**
 * Places one object and returns its objectId (the newest row of its type).
 * @param {GameEngine} engine
 * @param {ObjectType} type
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function placeObject(engine, type, x, y) {
    assert.equal(engine.applyMessage(new CreateObjectMessage(type.typeId, x, y, Direction.UP)), true);
    const eids = engine.placed.eidsOf(type.typeId);
    return engine.placed.objectIdOf(eids[eids.length - 1]);
}

/**
 * Runs `ticks` whole ticks with the input port kept fed and the output port drained, counting
 * cooked items — the machine's sustained production rate.
 * @param {GameEngine} engine
 * @param {number} inPort
 * @param {number} outPort
 * @param {number} ticks
 * @returns {number}
 */
function producedOver(engine, inPort, outPort, ticks) {
    let produced = 0;
    for (let i = 0; i < ticks; i += 1) {
        if (engine.ports.item(inPort) === EMPTY) {
            engine.ports.setItem(inPort, ITEM_TYPE_TEST_MACHINE_INPUT);
        }
        engine.tickAll();
        if (engine.ports.item(outPort) === ITEM_TYPE_TEST_MACHINE_OUTPUT) {
            produced += 1;
            engine.ports.setItem(outPort, EMPTY);
        }
    }
    return produced;
}

/**
 * The Machine component's carry (banked fractional progress) for one machine.
 * @param {GameEngine} engine
 * @param {number} objectId
 * @returns {number}
 */
function carryOf(engine, objectId) {
    const def = engine.components.get("Machine");
    return def.store.carry[def.row(engine.placed.eidByObjectId(objectId))];
}

// Housing at (2,4) (cells x2-3, y4-5), a road row along y=5, machines on y=4 each adjacent to the
// road tile below them.
async function mannedSetup() {
    const engine = await makeGameEngine([new ModPackage(new MachineFixtureDeclaration())]);
    const housingId = placeObject(engine, HousingDefinition, 2, 4);
    const roadIds = new Map();
    for (let x = 4; x <= 8; x += 1) {
        roadIds.set(x, placeObject(engine, RoadDefinition, x, 5));
    }
    const nearId = placeObject(engine, TestMachineType, 5, 4);
    const farId = placeObject(engine, TestMachineType, 8, 4);
    return {engine, housingId, roadIds, nearId, farId};
}

test("a machine road-connected to housing is manned and sustains a faster rate", async () => {
    const {engine, nearId} = await mannedSetup();
    const controlId = placeObject(engine, TestMachineType, 30, 10);

    const manned = engine.inspectSnapshot(nearId);
    assert.equal(manned.workerCost, TEST_MACHINE_WORKER_COST);
    assert.equal(manned.workers, TEST_MACHINE_WORKER_COST);
    assert.equal(manned.workerSupply, HOUSING_WORKER_SUPPLY);
    assert.equal(manned.workerDemand, 2 * TEST_MACHINE_WORKER_COST);

    const control = engine.inspectSnapshot(controlId);
    assert.equal(control.workers, 0);
    assert.equal(control.workerSupply, null, "road-less machine has no network stats");

    // The 1.3x multiplier shows up as sustained throughput (fractional progress carries over).
    const TICKS = 60;
    const mannedCount = producedOver(engine, engine.ports.at(5, 4, Direction.UP), engine.ports.at(5, 3, Direction.UP), TICKS);
    const controlCount = producedOver(engine, engine.ports.at(30, 10, Direction.UP), engine.ports.at(30, 9, Direction.UP), TICKS);
    assert.ok(mannedCount > controlCount, `manned ${mannedCount} items vs unmanned ${controlCount} over ${TICKS} ticks`);
});

test("fractional progress banks past a craft and shortens the next", async () => {
    const {engine, nearId} = await mannedSetup();
    const inPort = engine.ports.at(5, 4, Direction.UP);
    const outPort = engine.ports.at(5, 3, Direction.UP);

    // First craft (processingTicks 2 at 1.3/tick) overshoots by 0.6, banked as carry.
    engine.ports.setItem(inPort, ITEM_TYPE_TEST_MACHINE_INPUT);
    let produced = false;
    for (let i = 0; i < 8 && !produced; i += 1) {
        engine.tickAll();
        produced = engine.ports.item(outPort) === ITEM_TYPE_TEST_MACHINE_OUTPUT;
    }
    assert.ok(produced, "first craft completed");
    assert.ok(Math.abs(carryOf(engine, nearId) - 0.6) < 1e-3, `carry ${carryOf(engine, nearId)}`);

    // The next craft consumes the bank: it loads with remaining 1.4, not 2.
    engine.ports.setItem(outPort, EMPTY);
    engine.ports.setItem(inPort, ITEM_TYPE_TEST_MACHINE_INPUT);
    engine.tickAll();
    assert.equal(carryOf(engine, nearId), 0, "bank consumed at load");
    const def = engine.components.get("Machine");
    const remaining = def.store.remaining[def.row(engine.placed.eidByObjectId(nearId))];
    assert.ok(Math.abs(remaining - 1.4) < 1e-3, `remaining ${remaining}`);
});

test("a worker shortage staffs the closest machines first", async () => {
    const engine = await makeGameEngine([new ModPackage(new MachineFixtureDeclaration())]);
    placeObject(engine, HousingDefinition, 2, 4);
    // Two machines past what the supply fully staffs: full crews nearest; a remainder short of a
    // full crew staffs nobody.
    const fullGrants = Math.floor(HOUSING_WORKER_SUPPLY / TEST_MACHINE_WORKER_COST);
    const count = fullGrants + 2;
    for (let x = 4; x < 5 + count; x += 1) {
        placeObject(engine, RoadDefinition, x, 5);
    }
    const machineIds = [];
    for (let x = 5; x < 5 + count; x += 1) {
        machineIds.push(placeObject(engine, TestMachineType, x, 4));
    }
    for (const [i, machineId] of machineIds.entries()) {
        const expected = i < fullGrants ? TEST_MACHINE_WORKER_COST : 0;
        assert.equal(engine.inspectSnapshot(machineId).workers, expected, `machine at x=${5 + i}`);
    }
});

test("a distance tie staffs the older machine (lower objectId)", async () => {
    const engine = await makeGameEngine([new ModPackage(new MachineFixtureDeclaration())]);
    placeObject(engine, HousingDefinition, 2, 4);
    // Closer machines drain the supply down to one last full crew; it goes to one of two machines
    // at equal distance, and placement order must break the tie.
    const leadCount = Math.floor(HOUSING_WORKER_SUPPLY / TEST_MACHINE_WORKER_COST) - 1;
    for (let x = 4; x <= 5 + leadCount; x += 1) {
        placeObject(engine, RoadDefinition, x, 5);
    }
    for (let x = 5; x < 5 + leadCount; x += 1) {
        placeObject(engine, TestMachineType, x, 4);
    }
    const olderId = placeObject(engine, TestMachineType, 5 + leadCount, 4);
    const newerId = placeObject(engine, TestMachineType, 4 + leadCount, 6);
    assert.equal(engine.inspectSnapshot(olderId).workers, TEST_MACHINE_WORKER_COST);
    assert.equal(engine.inspectSnapshot(newerId).workers, 0);
});

test("cutting the road unmans the disconnected machine and emits the delta", async () => {
    const {engine, roadIds, nearId, farId} = await mannedSetup();
    const collector = new EventCollector(engine);
    assert.equal(engine.inspectSnapshot(farId).workers, TEST_MACHINE_WORKER_COST);
    collector.drain();

    assert.equal(engine.applyMessage(new DeleteObjectMessage(roadIds.get(6))), true);
    engine.tickAll();

    assert.equal(engine.inspectSnapshot(nearId).workers, TEST_MACHINE_WORKER_COST, "housing-side machine stays manned");
    assert.equal(engine.inspectSnapshot(farId).workers, 0, "cut-off machine loses its workers");
    const delta = collector.drain().find(event =>
        event instanceof WorkerAssignmentEvent && event.machineId === farId);
    assert.ok(delta, "assignment delta emitted");
    assert.equal(delta.housingId, NO_HOUSING);
});

test("deleting the housing unmans every machine", async () => {
    const {engine, housingId, nearId, farId} = await mannedSetup();
    assert.equal(engine.applyMessage(new DeleteObjectMessage(housingId)), true);
    assert.equal(engine.inspectSnapshot(nearId).workers, 0);
    assert.equal(engine.inspectSnapshot(farId).workers, 0);
});

test("a housing bridges two road stretches into one network with pooled supply", async () => {
    const engine = await makeGameEngine([new ModPackage(new MachineFixtureDeclaration())]);
    // housing (2,4) - road (4,5) - housing (5,4) - road (7,5): one network through the housings.
    placeObject(engine, HousingDefinition, 2, 4);
    placeObject(engine, RoadDefinition, 4, 5);
    placeObject(engine, HousingDefinition, 5, 4);
    placeObject(engine, RoadDefinition, 7, 5);
    const nearId = placeObject(engine, TestMachineType, 4, 4);
    const farId = placeObject(engine, TestMachineType, 7, 4);

    for (const machineId of [nearId, farId]) {
        const snapshot = engine.inspectSnapshot(machineId);
        assert.equal(snapshot.workerSupply, 2 * HOUSING_WORKER_SUPPLY, "both housings, counted once each");
        assert.equal(snapshot.workerDemand, 2 * TEST_MACHINE_WORKER_COST, "both machines share the network");
        assert.equal(snapshot.workers, TEST_MACHINE_WORKER_COST);
    }
});

test("directly adjacent housings pool their supply into one network", async () => {
    const engine = await makeGameEngine([new ModPackage(new MachineFixtureDeclaration())]);
    placeObject(engine, HousingDefinition, 2, 4);
    // Stacked on top of the first, touching no road itself.
    placeObject(engine, HousingDefinition, 2, 2);
    placeObject(engine, RoadDefinition, 4, 5);
    const machineId = placeObject(engine, TestMachineType, 4, 4);

    const snapshot = engine.inspectSnapshot(machineId);
    assert.equal(snapshot.workerSupply, 2 * HOUSING_WORKER_SUPPLY);
    assert.equal(snapshot.workers, TEST_MACHINE_WORKER_COST);
});

test("a new smaller-id component takes a machine from its old network", async () => {
    const engine = await makeGameEngine([new ModPackage(new MachineFixtureDeclaration())]);
    // Right network first: the machine's only road neighbor, so it staffs the machine.
    placeObject(engine, RoadDefinition, 7, 4);
    placeObject(engine, HousingDefinition, 8, 3);
    const machineId = placeObject(engine, TestMachineType, 6, 4);
    assert.equal(engine.inspectSnapshot(machineId).workers, TEST_MACHINE_WORKER_COST);

    // Left network: its road tile has the smaller tileId, so it outranks the right one.
    const collector = new EventCollector(engine);
    placeObject(engine, RoadDefinition, 5, 4);
    const leftHousingId = placeObject(engine, HousingDefinition, 3, 3);

    const deltas = collector.drain().filter(event =>
        event instanceof WorkerAssignmentEvent && event.machineId === machineId);
    assert.ok(deltas.length > 0, "reassignment delta emitted");
    assert.equal(deltas[deltas.length - 1].housingId, leftHousingId);
    const snapshot = engine.inspectSnapshot(machineId);
    assert.equal(snapshot.workers, TEST_MACHINE_WORKER_COST);
    assert.equal(snapshot.workerDemand, TEST_MACHINE_WORKER_COST, "left network's demand, not the right's");
});

test("a machine stays with its smaller-id network when a new one appears beside it", async () => {
    const engine = await makeGameEngine([new ModPackage(new MachineFixtureDeclaration())]);
    placeObject(engine, RoadDefinition, 5, 4);
    placeObject(engine, HousingDefinition, 3, 3);
    const machineId = placeObject(engine, TestMachineType, 6, 4);

    const collector = new EventCollector(engine);
    placeObject(engine, RoadDefinition, 7, 4);
    placeObject(engine, HousingDefinition, 8, 3);

    const deltas = collector.drain().filter(event =>
        event instanceof WorkerAssignmentEvent && event.machineId === machineId);
    assert.equal(deltas.length, 0, "no reassignment flicker");
    const snapshot = engine.inspectSnapshot(machineId);
    assert.equal(snapshot.workers, TEST_MACHINE_WORKER_COST);
    assert.equal(snapshot.workerSupply, HOUSING_WORKER_SUPPLY, "still only the left housing's supply");
});

test("chunk sync carries the manned assignments", async () => {
    const {engine, housingId, nearId, farId} = await mannedSetup();
    engine.tickAll();
    const events = flattenBatches(engine.chunkSync(chunkId(5, 4)));
    const assignments = events.filter(event => event instanceof WorkerAssignmentEvent);
    const byMachine = new Map(assignments.map(event => [event.machineId, event.housingId]));
    assert.equal(byMachine.get(nearId), housingId);
    assert.equal(byMachine.get(farId), housingId);
});

test("a non-directional type spawns facing UP whatever the message says", async () => {
    const engine = await makeGameEngine([new ModPackage(new MachineFixtureDeclaration())]);
    const collector = new EventCollector(engine);
    assert.equal(engine.applyMessage(new CreateObjectMessage(HousingDefinition.typeId, 2, 4, Direction.RIGHT)), true);
    const insert = collector.drain().find(event => event instanceof ObjectInsertEvent);
    assert.equal(insert.direction, Direction.UP);
});

test("worker assignments and banked progress survive a save/load", async () => {
    const {engine, nearId} = await mannedSetup();
    // Craft once (a single fed input) so the machine banks fractional progress, then idles.
    engine.ports.setItem(engine.ports.at(5, 4, Direction.UP), ITEM_TYPE_TEST_MACHINE_INPUT);
    let produced = false;
    for (let i = 0; i < 8 && !produced; i += 1) {
        engine.tickAll();
        produced = engine.ports.item(engine.ports.at(5, 3, Direction.UP)) === ITEM_TYPE_TEST_MACHINE_OUTPUT;
    }
    assert.ok(produced, "crafted before save");
    const carryBefore = carryOf(engine, nearId);
    assert.ok(carryBefore > 0, "fractional progress banked before save");

    // Through the structured SQLite store, so the float columns round-trip as REAL.
    const store = new NodeSaveStore(":memory:");
    await store.save(engine.snapshots.serialize());
    const snapshot = await store.load();

    const restored = await makeGameEngine([new ModPackage(new MachineFixtureDeclaration())]);
    restored.snapshots.deserialize(snapshot);

    assert.equal(restored.workers.roads.roadAt(5, 5), true, "road tiles rebuilt");
    assert.equal(restored.inspectSnapshot(nearId).workers, TEST_MACHINE_WORKER_COST, "allocation recomputed after load");
    assert.equal(carryOf(restored, nearId), carryBefore, "banked fractional progress restored");
});
