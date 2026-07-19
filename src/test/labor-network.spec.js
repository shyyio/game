import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent} from "@/common/ObjectEvents.js";
import {LaborAssignmentEvent, NO_HOUSING} from "@/common/LaborEvents.js";
import {
    DemoMachineType,
    ITEM_TYPE_DEMO_INPUT,
    ITEM_TYPE_DEMO_OUTPUT,
    DEMO_MACHINE_LABOR_COST,
} from "@/mods/Demo/declaration.js";
import {RoadDefinition, HousingDefinition} from "@/mods/Logistics/objectTypes.js";
import {HOUSING_LABOR_SUPPLY} from "@/mods/Logistics/constants.js";
import {EMPTY} from "@/common/sim/GameEngine.js";
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
        if (engine.portItem(inPort) === EMPTY) {
            engine.setPortItem(inPort, ITEM_TYPE_DEMO_INPUT);
        }
        engine.tickAll();
        if (engine.portItem(outPort) === ITEM_TYPE_DEMO_OUTPUT) {
            produced += 1;
            engine.setPortItem(outPort, EMPTY);
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
    const def = engine.component("Machine");
    return def.store.carry[def.row(engine.placed.eidByObjectId(objectId))];
}

// Housing at (2,4) (cells x2-3, y4-5), a road row along y=5, machines on y=4 each adjacent to the
// road tile below them.
async function mannedSetup() {
    const engine = await makeGameEngine();
    const housingId = placeObject(engine, HousingDefinition, 2, 4);
    const roadIds = new Map();
    for (let x = 4; x <= 8; x += 1) {
        roadIds.set(x, placeObject(engine, RoadDefinition, x, 5));
    }
    const nearId = placeObject(engine, DemoMachineType, 5, 4);
    const farId = placeObject(engine, DemoMachineType, 8, 4);
    return {engine, housingId, roadIds, nearId, farId};
}

test("a machine road-connected to housing is manned and sustains a faster rate", async () => {
    const {engine, nearId} = await mannedSetup();
    const controlId = placeObject(engine, DemoMachineType, 30, 10);

    const manned = engine.inspectSnapshot(nearId);
    assert.equal(manned.laborCost, DEMO_MACHINE_LABOR_COST);
    assert.equal(manned.laborWorkers, DEMO_MACHINE_LABOR_COST);
    assert.equal(manned.laborSupply, HOUSING_LABOR_SUPPLY);
    assert.equal(manned.laborDemand, 2 * DEMO_MACHINE_LABOR_COST);

    const control = engine.inspectSnapshot(controlId);
    assert.equal(control.laborWorkers, 0);
    assert.equal(control.laborSupply, null, "road-less machine has no network stats");

    // The 1.3x multiplier shows up as sustained throughput (fractional progress carries over).
    const TICKS = 60;
    const mannedCount = producedOver(engine, engine.portAt(5, 4, Direction.UP), engine.portAt(5, 3, Direction.UP), TICKS);
    const controlCount = producedOver(engine, engine.portAt(30, 10, Direction.UP), engine.portAt(30, 9, Direction.UP), TICKS);
    assert.ok(mannedCount > controlCount, `manned ${mannedCount} items vs unmanned ${controlCount} over ${TICKS} ticks`);
});

test("fractional progress banks past a craft and shortens the next", async () => {
    const {engine, nearId} = await mannedSetup();
    const inPort = engine.portAt(5, 4, Direction.UP);
    const outPort = engine.portAt(5, 3, Direction.UP);

    // First craft (processingTicks 2 at 1.3/tick) overshoots by 0.6, banked as carry.
    engine.setPortItem(inPort, ITEM_TYPE_DEMO_INPUT);
    let produced = false;
    for (let i = 0; i < 8 && !produced; i += 1) {
        engine.tickAll();
        produced = engine.portItem(outPort) === ITEM_TYPE_DEMO_OUTPUT;
    }
    assert.ok(produced, "first craft completed");
    assert.ok(Math.abs(carryOf(engine, nearId) - 0.6) < 1e-3, `carry ${carryOf(engine, nearId)}`);

    // The next craft consumes the bank: it loads with remaining 1.4, not 2.
    engine.setPortItem(outPort, EMPTY);
    engine.setPortItem(inPort, ITEM_TYPE_DEMO_INPUT);
    engine.tickAll();
    assert.equal(carryOf(engine, nearId), 0, "bank consumed at load");
    const def = engine.component("Machine");
    const remaining = def.store.remaining[def.row(engine.placed.eidByObjectId(nearId))];
    assert.ok(Math.abs(remaining - 1.4) < 1e-3, `remaining ${remaining}`);
});

test("a labor shortage staffs the closest machines first", async () => {
    const engine = await makeGameEngine();
    placeObject(engine, HousingDefinition, 2, 4);
    // Two machines past what the supply fully staffs: full grants nearest, then the remainder, then idle.
    const fullGrants = Math.floor(HOUSING_LABOR_SUPPLY / DEMO_MACHINE_LABOR_COST);
    const remainder = HOUSING_LABOR_SUPPLY % DEMO_MACHINE_LABOR_COST;
    const count = fullGrants + 2;
    for (let x = 4; x < 5 + count; x += 1) {
        placeObject(engine, RoadDefinition, x, 5);
    }
    const machineIds = [];
    for (let x = 5; x < 5 + count; x += 1) {
        machineIds.push(placeObject(engine, DemoMachineType, x, 4));
    }
    for (const [i, machineId] of machineIds.entries()) {
        let expected = 0;
        if (i < fullGrants) {
            expected = DEMO_MACHINE_LABOR_COST;
        } else if (i === fullGrants) {
            expected = remainder;
        }
        assert.equal(engine.inspectSnapshot(machineId).laborWorkers, expected, `machine at x=${5 + i}`);
    }
});

test("a distance tie staffs the older machine (lower objectId)", async () => {
    const engine = await makeGameEngine();
    placeObject(engine, HousingDefinition, 2, 4);
    // Closer machines drain the supply down to one last grant; it goes to one of two machines at
    // equal distance, and placement order must break the tie.
    const leadCount = Math.ceil(HOUSING_LABOR_SUPPLY / DEMO_MACHINE_LABOR_COST) - 1;
    const leftover = HOUSING_LABOR_SUPPLY - leadCount * DEMO_MACHINE_LABOR_COST;
    for (let x = 4; x <= 5 + leadCount; x += 1) {
        placeObject(engine, RoadDefinition, x, 5);
    }
    for (let x = 5; x < 5 + leadCount; x += 1) {
        placeObject(engine, DemoMachineType, x, 4);
    }
    const olderId = placeObject(engine, DemoMachineType, 5 + leadCount, 4);
    const newerId = placeObject(engine, DemoMachineType, 4 + leadCount, 6);
    assert.equal(engine.inspectSnapshot(olderId).laborWorkers, leftover);
    assert.equal(engine.inspectSnapshot(newerId).laborWorkers, 0);
});

test("cutting the road unmans the disconnected machine and emits the delta", async () => {
    const {engine, roadIds, nearId, farId} = await mannedSetup();
    const collector = new EventCollector(engine);
    assert.equal(engine.inspectSnapshot(farId).laborWorkers, DEMO_MACHINE_LABOR_COST);
    collector.drain();

    assert.equal(engine.applyMessage(new DeleteObjectMessage(roadIds.get(6))), true);
    engine.tickAll();

    assert.equal(engine.inspectSnapshot(nearId).laborWorkers, DEMO_MACHINE_LABOR_COST, "housing-side machine stays manned");
    assert.equal(engine.inspectSnapshot(farId).laborWorkers, 0, "cut-off machine loses its labor");
    const delta = collector.drain().find(event =>
        event instanceof LaborAssignmentEvent && event.machineId === farId);
    assert.ok(delta, "assignment delta emitted");
    assert.equal(delta.housingId, NO_HOUSING);
});

test("deleting the housing unmans every machine", async () => {
    const {engine, housingId, nearId, farId} = await mannedSetup();
    assert.equal(engine.applyMessage(new DeleteObjectMessage(housingId)), true);
    assert.equal(engine.inspectSnapshot(nearId).laborWorkers, 0);
    assert.equal(engine.inspectSnapshot(farId).laborWorkers, 0);
});

test("chunk sync carries the manned assignments", async () => {
    const {engine, housingId, nearId, farId} = await mannedSetup();
    engine.tickAll();
    const events = flattenBatches(engine.chunkSync(chunkId(5, 4)));
    const assignments = events.filter(event => event instanceof LaborAssignmentEvent);
    const byMachine = new Map(assignments.map(event => [event.machineId, event.housingId]));
    assert.equal(byMachine.get(nearId), housingId);
    assert.equal(byMachine.get(farId), housingId);
});

test("a non-directional type spawns facing UP whatever the message says", async () => {
    const engine = await makeGameEngine();
    const collector = new EventCollector(engine);
    assert.equal(engine.applyMessage(new CreateObjectMessage(HousingDefinition.typeId, 2, 4, Direction.RIGHT)), true);
    const insert = collector.drain().find(event => event instanceof ObjectInsertEvent);
    assert.equal(insert.direction, Direction.UP);
});

test("labor assignments and banked progress survive a save/load", async () => {
    const {engine, nearId} = await mannedSetup();
    // Craft once (a single fed input) so the machine banks fractional progress, then idles.
    engine.setPortItem(engine.portAt(5, 4, Direction.UP), ITEM_TYPE_DEMO_INPUT);
    let produced = false;
    for (let i = 0; i < 8 && !produced; i += 1) {
        engine.tickAll();
        produced = engine.portItem(engine.portAt(5, 3, Direction.UP)) === ITEM_TYPE_DEMO_OUTPUT;
    }
    assert.ok(produced, "crafted before save");
    const carryBefore = carryOf(engine, nearId);
    assert.ok(carryBefore > 0, "fractional progress banked before save");

    // Through the structured SQLite store, so the float columns round-trip as REAL.
    const store = new NodeSaveStore(":memory:");
    await store.save(engine.serialize());
    const snapshot = await store.load();

    const restored = await makeGameEngine();
    restored.deserialize(snapshot);

    assert.equal(restored.labor.roadAt(5, 5), true, "road tiles rebuilt");
    assert.equal(restored.inspectSnapshot(nearId).laborWorkers, DEMO_MACHINE_LABOR_COST, "allocation recomputed after load");
    assert.equal(carryOf(restored, nearId), carryBefore, "banked fractional progress restored");
});
