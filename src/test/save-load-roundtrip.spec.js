import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {WaterResourceType, ExtractorType, BlenderType} from "@/mods/base-game/common/objectTypes.js";
import {ITEM_TYPE_WATER} from "@/mods/base-game/common/constants.js";
import {SplitterType, BeltType} from "@/mods/logistics/common/objectTypes.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {LAYER_RESOURCE} from "@/sim/behaviors/ResourceBehavior.js";

// Populates an engine with one of every migrated object type and ticks it a few times.
async function populated() {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.objectTypeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(BlenderType.objectTypeId, 10, 10, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(SplitterType.objectTypeId, 3, 8, Direction.UP));
    const splitterEid = engine.placed.getEidsByTypeId(SplitterType.objectTypeId)[0];
    const splitterId = engine.placed.getObjectRefByEid(splitterEid);
    for (const cell of [{x: 20, y: 20}, {x: 20, y: 21}, {x: 20, y: 22}]) {
        engine.applyMessage(new CreateObjectMessage(BeltType.objectTypeId, cell.x, cell.y, Direction.UP));
    }
    for (let i = 0; i < 3; i += 1) {
        engine.tick();
    }
    return {engine, splitterId, beltLanes: engine.lanes.getLaneRefs().length};
}

test("the whole world round-trips through the engine serializer", async () => {
    const {engine, splitterId, beltLanes} = await populated();
    const snapshot = engine.snapshots.serialize();

    const restored = await makeGameEngine();
    restored.snapshots.deserialize(snapshot);

    assert.equal(restored.placed.getEidsByTypeId(ExtractorType.objectTypeId).length, 1, "extractor restored");
    assert.equal(restored.placed.getEidsByTypeId(BlenderType.objectTypeId).length, 1, "machine restored");
    assert.equal(restored.lanes.getLaneRefs().length, beltLanes, "belt lanes restored");
    assert.notEqual(restored.space.getUserDataAt(5, 5, LAYER_RESOURCE), null, "resource cover restored");
    assert.notEqual(restored.placed.findEidByObjectRef(splitterId), undefined, "splitter restored");
    assert.equal(restored.space.isEveryCellFree([{x: 10, y: 10, layer: LAYER_SURFACE}]), false, "machine position restored");

    // The extractor keeps producing water into its edge output port after the load.
    const outputPort = restored.ports.getPortEidAt(5, 4, Direction.UP);
    assert.deepEqual(restored.render.findPortTileByEid(outputPort), {x: 5, y: 4}, "output port re-registered at its own tile");
    for (const tile of [{x: 3, y: 7}, {x: 4, y: 7}]) {
        const port = restored.ports.getPortEidAt(tile.x, tile.y, Direction.UP);
        assert.deepEqual(restored.render.findPortTileByEid(port), tile, "splitter output port re-registered at its own tile");
    }
    let produced = false;
    for (let i = 0; i < 8 && !produced; i += 1) {
        restored.tick();
        produced = restored.ports.getItemByPortEid(outputPort) === ITEM_TYPE_WATER;
    }
    assert.ok(produced, "restored extractor still produces");
});

test("a snapshot survives a JSON blob round-trip (the client save path)", async () => {
    const {engine, splitterId} = await populated();
    const snapshot = JSON.parse(JSON.stringify(engine.snapshots.serialize()));

    const restored = await makeGameEngine();
    restored.snapshots.deserialize(snapshot);

    assert.equal(restored.placed.getEidsByTypeId(BlenderType.objectTypeId).length, 1);
    assert.notEqual(restored.placed.findEidByObjectRef(splitterId), undefined);
});

test("a snapshot round-trips through structured SQLite (the node save path)", async () => {
    const {engine} = await populated();
    const store = new NodeSaveStore(":memory:");
    await store.save(engine.snapshots.serialize());

    const loaded = await store.load();
    const names = loaded.components.map(component => component.name);
    for (const name of ["Port", "Position", "Occupancy", "PlacedObject", "Machine", "Extractor", "Splitter", "Lane", "LaneCell", "LaneItem"]) {
        assert.ok(names.includes(name), `${name} table present`);
    }

    const restored = await makeGameEngine();
    restored.snapshots.deserialize(loaded);
    assert.equal(restored.placed.getEidsByTypeId(ExtractorType.objectTypeId).length, 1);
    assert.equal(restored.placed.getEidsByTypeId(BlenderType.objectTypeId).length, 1);
});

test("load returns null when nothing was saved", async () => {
    const store = new NodeSaveStore(":memory:");
    assert.equal(await store.load(), null);
});
