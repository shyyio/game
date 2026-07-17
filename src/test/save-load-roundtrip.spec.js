import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {DemoMachineType} from "@/mods/Demo/declaration.js";
import {WaterResourceType, ExtractorType, WATER_ITEM_TYPE} from "@/mods/Resources/declaration.js";
import {SplitterDefinition} from "@/mods/Logistics/objectTypes.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {beltsOf} from "@/mods/Logistics/testHelpers.js";

// Populates an engine with one of every migrated object type and ticks it a few times.
async function populated() {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.typeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.typeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(DemoMachineType.typeId, 10, 10, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(SplitterDefinition.typeId, 3, 8, Direction.UP));
    const splitterEid = engine.placed.eidsOf(SplitterDefinition.typeId)[0];
    const splitterId = engine.placed.PlacedObject.clientId[splitterEid];
    [{x: 20, y: 20}, {x: 20, y: 21}, {x: 20, y: 22}].forEach(cell =>
        engine.applyMessage(new CreateBeltMessage(cell.x, cell.y, Direction.UP, BELT_NORMAL)));
    for (let i = 0; i < 3; i += 1) {
        engine.tickAll();
    }
    return {engine, splitterId, beltPaths: beltsOf(engine).paths.length};
}

test("the whole world round-trips through the engine serializer", async () => {
    const {engine, splitterId, beltPaths} = await populated();
    const snapshot = engine.serialize();

    const restored = await makeGameEngine();
    restored.deserialize(snapshot);

    assert.equal(restored.placed.eidsOf(ExtractorType.typeId).length, 1, "extractor restored");
    assert.equal(restored.placed.eidsOf(DemoMachineType.typeId).length, 1, "machine restored");
    assert.equal(beltsOf(restored).paths.length, beltPaths, "belt paths restored");
    assert.notEqual(restored.occupantValueAt(5, 5, "R"), null, "resource cover restored");
    assert.notEqual(restored.placed.eidByClientId(splitterId), undefined, "splitter restored");
    assert.equal(restored.occupancyFree([{x: 10, y: 10, layer: "S"}]), false, "machine occupancy restored");

    // The extractor keeps producing water into its edge out-port after the load.
    const outPort = restored.portAt(5, 4, Direction.UP);
    let produced = false;
    for (let i = 0; i < 8 && !produced; i += 1) {
        restored.tickAll();
        produced = restored.portItem(outPort) === WATER_ITEM_TYPE;
    }
    assert.ok(produced, "restored extractor still produces");
});

test("a snapshot survives a JSON blob round-trip (the client save path)", async () => {
    const {engine, splitterId} = await populated();
    const snapshot = JSON.parse(JSON.stringify(engine.serialize()));

    const restored = await makeGameEngine();
    restored.deserialize(snapshot);

    assert.equal(restored.placed.eidsOf(DemoMachineType.typeId).length, 1);
    assert.notEqual(restored.placed.eidByClientId(splitterId), undefined);
});

test("a snapshot round-trips through structured SQLite (the node save path)", async () => {
    const {engine} = await populated();
    const store = new NodeSaveStore(":memory:");
    await store.save(engine.serialize());

    const loaded = await store.load();
    const names = loaded.components.map(component => component.name);
    ["Port", "Occupancy", "PlacedObject", "Machine", "Extractor", "Splitter", "BeltPath", "Belt", "BeltRun"].forEach(name => {
        assert.ok(names.includes(name), `${name} table present`);
    });

    const restored = await makeGameEngine();
    restored.deserialize(loaded);
    assert.equal(restored.placed.eidsOf(ExtractorType.typeId).length, 1);
    assert.equal(restored.placed.eidsOf(DemoMachineType.typeId).length, 1);
});

test("load returns null when nothing was saved", async () => {
    const store = new NodeSaveStore(":memory:");
    assert.equal(await store.load(), null);
});
