import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGameEngine} from "@/test/ecsSim.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";

test("a snapshot deserializes fine against the same loadout", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.serialize();

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.deserialize(snapshot));
});

test("a snapshot whose object type list is a prefix of the current loadout still loads", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.serialize();
    // Simulate an older save written before a mod appended new object types at the tail.
    snapshot.objectTypeNames = snapshot.objectTypeNames.slice(0, 5);

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.deserialize(snapshot));
});

test("a reordered/removed object type is rejected with a clear error", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.serialize();
    snapshot.objectTypeNames = [...snapshot.objectTypeNames];
    // Swap two entries, simulating a mod reorder that shifted every typeId after it.
    [snapshot.objectTypeNames[0], snapshot.objectTypeNames[1]] = [snapshot.objectTypeNames[1], snapshot.objectTypeNames[0]];

    const restored = await makeGameEngine();
    assert.throws(
        () => restored.deserialize(snapshot),
        /incompatible with the current mod loadout/,
    );
});

test("a snapshot with more object types than the current loadout is rejected", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.serialize();
    snapshot.objectTypeNames = [...snapshot.objectTypeNames, "SomeRemovedType"];

    const restored = await makeGameEngine();
    assert.throws(
        () => restored.deserialize(snapshot),
        /incompatible with the current mod loadout/,
    );
});

test("a snapshot missing objectTypeNames entirely (pre-dates the check) is rejected", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.serialize();
    delete snapshot.objectTypeNames;

    const restored = await makeGameEngine();
    assert.throws(
        () => restored.deserialize(snapshot),
        /pre-dates this check/,
    );
});

test("NodeSaveStore round-trips objectTypeNames through SQLite", async () => {
    const engine = await makeGameEngine();
    const store = new NodeSaveStore(":memory:");
    await store.save(engine.serialize());
    const loaded = await store.load();

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.deserialize(loaded));
});

test("a component that no longer exists is rejected", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.serialize();
    snapshot.components = [...snapshot.components, {name: "RetiredComponent", fields: [], rows: []}];

    const restored = await makeGameEngine();
    assert.throws(
        () => restored.deserialize(snapshot),
        /"RetiredComponent" is in the save but no longer registered/,
    );
});

test("a component missing from the save is rejected", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.serialize();
    const dropped = snapshot.components[0].name;
    snapshot.components = snapshot.components.slice(1);

    const restored = await makeGameEngine();
    assert.throws(
        () => restored.deserialize(snapshot),
        new RegExp(`"${dropped}" is registered but missing from the save`),
    );
});

test("a field added since the save was written is rejected instead of silently zero-filled", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.serialize();
    const component = snapshot.components.find(entry => entry.fields.length > 0);
    const dropped = component.fields[0].name;
    component.fields = component.fields.slice(1);

    const restored = await makeGameEngine();
    assert.throws(
        () => restored.deserialize(snapshot),
        new RegExp(`${component.name}\\.${dropped} is registered but missing from the save`),
    );
});

test("a field removed since the save was written is rejected instead of silently dropped", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.serialize();
    const component = snapshot.components[0];
    component.fields = [...component.fields, {name: "retiredField", kind: "i32"}];

    const restored = await makeGameEngine();
    assert.throws(
        () => restored.deserialize(snapshot),
        new RegExp(`${component.name}\\.retiredField is in the save but no longer registered`),
    );
});

test("a field whose kind changed is rejected instead of reinterpreted", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.serialize();
    const component = snapshot.components.find(entry => entry.fields.some(field => field.kind === "i32"));
    const field = component.fields.find(entry => entry.kind === "i32");
    field.kind = "eid";

    const restored = await makeGameEngine();
    assert.throws(
        () => restored.deserialize(snapshot),
        new RegExp(`${component.name}\\.${field.name} was saved as "eid", now "i32"`),
    );
});

test("NodeSaveStore reports objectTypeNames as null for a save written before this check existed", async () => {
    const engine = await makeGameEngine();
    const store = new NodeSaveStore(":memory:");
    const snapshot = engine.serialize();
    delete snapshot.objectTypeNames;
    await store.save(snapshot);
    const loaded = await store.load();

    assert.equal(loaded.objectTypeNames, null);
});
