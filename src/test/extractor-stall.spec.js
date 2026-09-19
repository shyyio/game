import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent, ObjectFieldsEvent} from "@/common/ObjectEvents.js";
import {WaterResourceType, ExtractorType} from "@/mods/base-game/common/objectTypes.js";
import {ITEM_TYPE_WATER} from "@/mods/base-game/common/constants.js";
import {EMPTY} from "@/sim/AbstractComponent.js";
import {makeGameEngine, ProbeSystem} from "@/test/ecsSim.js";
import {migrateSnapshot} from "@/common/saveMigrations.js";
import {EventCollector} from "@/test/EventCollector.js";

// The extractor's output port, with nothing placed to take from it.
const TILE_X = 5;
const TILE_Y = 5;

/**
 * A water extractor on its resource, its output port, and the collector drained past placement.
 */
async function setup() {
    const engine = await makeGameEngine();
    const collector = new EventCollector(engine);
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.objectTypeId, TILE_X, TILE_Y, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, TILE_X, TILE_Y, Direction.UP));
    engine.tick();
    const insert = collector.drain().find(event => event instanceof ObjectInsertEvent && event.objectTypeId === ExtractorType.objectTypeId);
    return {
        engine,
        collector,
        objectRef: insert.objectRef,
        outputPort: engine.ports.getPortEidAt(TILE_X, TILE_Y - 1, Direction.UP),
    };
}

/**
 * The stall values of every field event addressed to `objectRef`, in arrival order.
 * @param {AbstractEvent[]} events
 * @param {number} objectRef
 * @returns {number[]}
 */
function stallValues(events, objectRef) {
    return events
        .filter(event => event instanceof ObjectFieldsEvent && event.objectRef === objectRef)
        .map(event => event.values[1]);
}

test("an extractor that cannot deliver its finished product syncs as stalled, once", async () => {
    const {engine, collector, objectRef} = await setup();
    for (let i = 0; i < 24; i += 1) {
        engine.tick();
    }
    assert.deepEqual(stallValues(collector.drain(), objectRef), [1], "one stall edge while the output stays blocked");
});

test("an extractor whose product is taken syncs as running again, once", async () => {
    const {engine, collector, objectRef, outputPort} = await setup();
    for (let i = 0; i < 24; i += 1) {
        engine.tick();
    }
    assert.deepEqual(stallValues(collector.drain(), objectRef), [1], "stalled before the port is freed");

    let shouldDrain = true;
    engine.registerSystem(new ProbeSystem({submitIntents: () => {
        if (shouldDrain && engine.ports.getItemByPortEid(outputPort) !== EMPTY) {
            engine.transfers.submitDrain(outputPort);
        }
    }}));
    engine.tick();
    shouldDrain = false;
    engine.tick();
    assert.deepEqual(stallValues(collector.drain(), objectRef), [0], "one running edge once the product is taken");
});

test("an extractor delivering every cycle sends no stall traffic", async () => {
    const {engine, collector, objectRef, outputPort} = await setup();
    engine.registerSystem(new ProbeSystem({submitIntents: () => {
        if (engine.ports.getItemByPortEid(outputPort) !== EMPTY) {
            engine.transfers.submitDrain(outputPort);
        }
    }}));
    for (let i = 0; i < 64; i += 1) {
        engine.tick();
    }
    assert.deepEqual(stallValues(collector.drain(), objectRef), [], "a draining extractor never flips the stall field");
});

test("the stall flag stays out of the save and is recomputed on load", async () => {
    const {engine} = await setup();
    for (let i = 0; i < 24; i += 1) {
        engine.tick();
    }
    const snapshot = engine.snapshots.serialize();
    const extractor = snapshot.components.find(component => component.name === "Extractor");
    assert.ok(extractor.fields.every(field => field.name !== "isStalled"), "the stall flag is not saved");

    const restored = await makeGameEngine();
    const collector = new EventCollector(restored);
    restored.snapshots.deserialize(migrateSnapshot(snapshot));
    collector.drain();
    restored.tick();
    const stalled = collector.drain().filter(event => event instanceof ObjectFieldsEvent && event.values[1] === 1);
    assert.equal(stalled.length, 1, "the loaded extractor stalls again on its first tick");
});
