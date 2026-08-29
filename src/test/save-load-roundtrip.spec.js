import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {WaterResourceType, ExtractorType, BlenderType} from "@/mods/BaseGame/common/objectTypes.js";
import {ITEM_TYPE_WATER} from "@/mods/BaseGame/common/constants.js";
import {SplitterDefinition, BeltDefinition} from "@/mods/Logistics/common/objectTypes.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {beltsOf} from "@/mods/Logistics/sim/testHelpers.js";

// Populates an engine with one of every migrated object type and ticks it a few times.
async function populated() {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.typeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.typeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(BlenderType.typeId, 10, 10, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(SplitterDefinition.typeId, 3, 8, Direction.UP));
    const splitterEid = engine.placed.eidsOf(SplitterDefinition.typeId)[0];
    const splitterId = engine.placed.objectIdOf(splitterEid);
    for (const cell of [{x: 20, y: 20}, {x: 20, y: 21}, {x: 20, y: 22}]) {
        engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, cell.x, cell.y, Direction.UP));
    }
    for (let i = 0; i < 3; i += 1) {
        engine.tickAll();
    }
    return {engine, splitterId, beltPaths: beltsOf(engine).paths.length};
}

test("the whole world round-trips through the engine serializer", async () => {
    const {engine, splitterId, beltPaths} = await populated();
    const snapshot = engine.snapshots.serialize();

    const restored = await makeGameEngine();
    restored.snapshots.deserialize(snapshot);

    assert.equal(restored.placed.eidsOf(ExtractorType.typeId).length, 1, "extractor restored");
    assert.equal(restored.placed.eidsOf(BlenderType.typeId).length, 1, "machine restored");
    assert.equal(beltsOf(restored).paths.length, beltPaths, "belt paths restored");
    assert.notEqual(restored.space.userDataAt(5, 5, "R"), null, "resource cover restored");
    assert.notEqual(restored.placed.eidByObjectId(splitterId), undefined, "splitter restored");
    assert.equal(restored.space.cellsFree([{x: 10, y: 10, layer: "S"}]), false, "machine position restored");

    // The extractor keeps producing water into its edge out-port after the load.
    const outPort = restored.ports.at(5, 4, Direction.UP);
    assert.deepEqual(restored.render.portTile(outPort), {x: 5, y: 4}, "out-port re-registered at its own tile");
    for (const tile of [{x: 3, y: 7}, {x: 4, y: 7}]) {
        const port = restored.ports.at(tile.x, tile.y, Direction.UP);
        assert.deepEqual(restored.render.portTile(port), tile, "splitter out-port re-registered at its own tile");
    }
    let produced = false;
    for (let i = 0; i < 8 && !produced; i += 1) {
        restored.tickAll();
        produced = restored.ports.item(outPort) === ITEM_TYPE_WATER;
    }
    assert.ok(produced, "restored extractor still produces");
});

test("a snapshot survives a JSON blob round-trip (the client save path)", async () => {
    const {engine, splitterId} = await populated();
    const snapshot = JSON.parse(JSON.stringify(engine.snapshots.serialize()));

    const restored = await makeGameEngine();
    restored.snapshots.deserialize(snapshot);

    assert.equal(restored.placed.eidsOf(BlenderType.typeId).length, 1);
    assert.notEqual(restored.placed.eidByObjectId(splitterId), undefined);
});

test("a snapshot round-trips through structured SQLite (the node save path)", async () => {
    const {engine} = await populated();
    const store = new NodeSaveStore(":memory:");
    await store.save(engine.snapshots.serialize());

    const loaded = await store.load();
    const names = loaded.components.map(component => component.name);
    for (const name of ["Port", "Position", "Occupancy", "PlacedObject", "Machine", "Extractor", "Splitter", "BeltPath", "BeltPathMember", "BeltItem"]) {
        assert.ok(names.includes(name), `${name} table present`);
    }

    const restored = await makeGameEngine();
    restored.snapshots.deserialize(loaded);
    assert.equal(restored.placed.eidsOf(ExtractorType.typeId).length, 1);
    assert.equal(restored.placed.eidsOf(BlenderType.typeId).length, 1);
});

test("load returns null when nothing was saved", async () => {
    const store = new NodeSaveStore(":memory:");
    assert.equal(await store.load(), null);
});
