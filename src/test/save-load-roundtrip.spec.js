import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {DemoMachineDefinition} from "@/mods/DemoMod/DemoMod.js";
import {WaterResourceDefinition, ExtractorDefinition, WATER_ITEM_TYPE} from "@/mods/Resources/Resources.js";
import {SplitterDefinition} from "@/mods/Logistics/definitions.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {makeEcsSimEngine} from "@/test/ecsSim.js";

// Populates an engine with one of every migrated object type and ticks it a few times.
async function populated() {
    const engine = await makeEcsSimEngine();
    engine.applyMessage(new CreateObjectMessage(WaterResourceDefinition.typeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorDefinition.typeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(DemoMachineDefinition.typeId, 10, 10, Direction.UP));
    const splitter = engine.splitter.placeSplitter(3, 8, true);
    [{x: 20, y: 20}, {x: 20, y: 21}, {x: 20, y: 22}].forEach(cell =>
        engine.applyMessage(new CreateBeltMessage(cell.x, cell.y, Direction.UP, BELT_NORMAL)));
    for (let i = 0; i < 3; i += 1) {
        engine.tickAll();
    }
    return {engine, splitterId: splitter.clientId, beltPaths: engine.belts.paths.length};
}

test("the whole world round-trips through the engine serializer", async () => {
    const {engine, splitterId, beltPaths} = await populated();
    const snapshot = engine.serialize();

    const restored = await makeEcsSimEngine();
    restored.deserialize(snapshot);

    assert.equal(restored.extractor.eids().length, 1, "extractor restored");
    assert.equal(restored.machine.eids().length, 1, "machine restored");
    assert.equal(restored.belts.paths.length, beltPaths, "belt paths restored");
    assert.notEqual(restored.resources.coverAt(5, 5), null, "resource cover restored");
    assert.notEqual(restored.splitter.eidByClientId(splitterId), undefined, "splitter restored");
    assert.equal(restored.engine.occupancyFree([{x: 10, y: 10, layer: "S"}]), false, "machine occupancy restored");

    // The extractor keeps producing water into its edge out-port after the load.
    const outPort = restored.engine.portAt(5, 4, Direction.UP);
    let produced = false;
    for (let i = 0; i < 8 && !produced; i += 1) {
        restored.tickAll();
        produced = restored.engine.portItem(outPort) === WATER_ITEM_TYPE;
    }
    assert.ok(produced, "restored extractor still produces");
});

test("a snapshot survives a JSON blob round-trip (the client save path)", async () => {
    const {engine, splitterId} = await populated();
    const snapshot = JSON.parse(JSON.stringify(engine.serialize()));

    const restored = await makeEcsSimEngine();
    restored.deserialize(snapshot);

    assert.equal(restored.machine.eids().length, 1);
    assert.notEqual(restored.splitter.eidByClientId(splitterId), undefined);
});

test("a snapshot round-trips through structured SQLite (the node save path)", async () => {
    const {engine} = await populated();
    const store = new NodeSaveStore(":memory:");
    await store.save(engine.serialize());

    const loaded = await store.load();
    const names = loaded.components.map(component => component.name);
    ["Port", "Occupancy", "Machine", "Extractor", "Splitter", "WaterResource", "VolcanoResource", "ResourceCover", "BeltPath", "Belt", "BeltPathItem"].forEach(name => {
        assert.ok(names.includes(name), `${name} table present`);
    });

    const restored = await makeEcsSimEngine();
    restored.deserialize(loaded);
    assert.equal(restored.extractor.eids().length, 1);
    assert.equal(restored.machine.eids().length, 1);
});

test("load returns null when nothing was saved", async () => {
    const store = new NodeSaveStore(":memory:");
    assert.equal(await store.load(), null);
});
