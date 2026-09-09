import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGameEngine} from "@/test/ecsSim.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {migrateSnapshot, SAVE_FORMAT} from "@/common/saveMigrations.js";
import {GAME_VERSION, Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {BlenderType} from "@/mods/base-game/common/objectTypes.js";
import {GateDefinition} from "@/mods/logistics/common/objectTypes.js";
import {TankDefinition} from "@/mods/fluids/common/objectTypes.js";

test("a fresh snapshot carries the current format and the writing version", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.snapshots.serialize();

    assert.equal(snapshot.saveFormat, SAVE_FORMAT);
    assert.equal(snapshot.gameVersion, GAME_VERSION);
});

test("a snapshot already at the current format passes through untouched", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.snapshots.serialize();

    assert.equal(migrateSnapshot(snapshot), snapshot);
});

test("an unstamped save is upgraded to the current format", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.snapshots.serialize();
    delete snapshot.saveFormat;
    delete snapshot.gameVersion;

    const migrated = migrateSnapshot(snapshot);
    assert.equal(migrated.saveFormat, SAVE_FORMAT);
    assert.equal(migrated.gameVersion, null);

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.snapshots.deserialize(migrated));
});

test("migrations run in order, each handing its output to the next", () => {
    // Stand-in chain, one entry per real format, so this holds as SAVE_FORMAT moves.
    const migrations = new Map();
    const expected = [];
    for (let format = 0; format < SAVE_FORMAT; format++) {
        migrations.set(format, snapshot => ({...snapshot, saveFormat: format + 1, steps: [...snapshot.steps, format]}));
        expected.push(format);
    }
    const migrated = migrateSnapshot({saveFormat: 0, steps: []}, migrations);

    assert.equal(migrated.saveFormat, SAVE_FORMAT);
    assert.deepEqual(migrated.steps, expected);
});

test("a gap in the migration chain is rejected", () => {
    assert.throws(
        () => migrateSnapshot({saveFormat: 0}, new Map()),
        /No migration from save format 0 to 1/,
    );
});

test("a migration that fails to advance the format is rejected", () => {
    const migrations = new Map([[0, snapshot => ({...snapshot})]]);

    assert.throws(
        () => migrateSnapshot({saveFormat: 0}, migrations),
        /left the snapshot at 0, not 1/,
    );
});

test("a save from a newer build is rejected rather than downgraded", () => {
    assert.throws(
        () => migrateSnapshot({saveFormat: SAVE_FORMAT + 1}),
        /written by a newer build/,
    );
});

test("a nonsense format is rejected", () => {
    assert.throws(() => migrateSnapshot({saveFormat: "1"}), /nonsense format/);
    assert.throws(() => migrateSnapshot({saveFormat: -1}), /nonsense format/);
});

test("deserialize refuses a snapshot that has not been migrated", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.snapshots.serialize();
    delete snapshot.saveFormat;

    const restored = await makeGameEngine();
    assert.throws(
        () => restored.snapshots.deserialize(snapshot),
        /unstamped \(pre-dates save formats\)/,
    );
});

test("a format-2 save gains Machine.enabled, and every machine loads switched on", async () => {
    const engine = await makeGameEngine();
    assert.equal(engine.applyMessage(new CreateObjectMessage(BlenderType.typeId, 4, 4, Direction.UP)), true);
    const snapshot = engine.snapshots.serialize();
    snapshot.saveFormat = 2;
    const machine = snapshot.components.find(component => component.name === "Machine");
    assert.equal(machine.rows.length, 1);
    machine.fields = machine.fields.filter(field => field.name !== "enabled");
    for (const row of machine.rows) {
        delete row.enabled;
    }

    const migrated = migrateSnapshot(snapshot);
    const upgraded = migrated.components.find(component => component.name === "Machine");
    assert.ok(upgraded.fields.some(field => field.name === "enabled"));
    for (const row of upgraded.rows) {
        assert.equal(row.enabled, 1);
    }

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.snapshots.deserialize(migrated));
});

test("a format-4 save's PlacedObject.ownerId is renamed to placedBy", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BlenderType.typeId, 6, 6, Direction.UP));
    const snapshot = engine.snapshots.serialize();
    snapshot.saveFormat = 4;
    const placed = snapshot.components.find(component => component.name === "PlacedObject");
    assert.equal(placed.rows.length, 1);
    for (const field of placed.fields) {
        if (field.name === "placedBy") {
            field.name = "ownerId";
        }
    }
    for (const row of placed.rows) {
        row.ownerId = row.placedBy;
        delete row.placedBy;
    }

    const migrated = migrateSnapshot(snapshot);
    const upgraded = migrated.components.find(component => component.name === "PlacedObject");
    assert.ok(upgraded.fields.some(field => field.name === "placedBy"));
    assert.ok(!upgraded.fields.some(field => field.name === "ownerId"));
    for (const row of upgraded.rows) {
        assert.equal(row.ownerId, undefined);
    }

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.snapshots.deserialize(migrated));
    assert.equal(restored.placed.eidsOf(BlenderType.typeId).length, 1);
});

test("NodeSaveStore round-trips the format stamp", async () => {
    const engine = await makeGameEngine();
    const store = new NodeSaveStore(":memory:");
    await store.save(engine.snapshots.serialize());
    const loaded = await store.load();

    assert.equal(loaded.saveFormat, SAVE_FORMAT);
    assert.equal(loaded.gameVersion, GAME_VERSION);
});

test("NodeSaveStore reads a save written before the stamp as unstamped", async () => {
    const engine = await makeGameEngine();
    const store = new NodeSaveStore(":memory:");
    await store.save(engine.snapshots.serialize());
    store.db.exec('DROP TABLE "_Meta"');

    const loaded = await store.load();
    assert.equal(loaded.saveFormat, undefined);

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.snapshots.deserialize(migrateSnapshot(loaded)));
});

test("a format-3 save, whose id columns were plain i32, loads with them retagged", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BlenderType.typeId, 3, 3, Direction.UP));
    const snapshot = engine.snapshots.serialize();
    snapshot.saveFormat = 3;
    for (const component of snapshot.components) {
        for (const field of component.fields) {
            if (field.kind === "type" || field.kind === "item") {
                field.kind = "i32";
            }
        }
    }
    // Gate.lastOutput arrived at format 6, so a format-3 save has none for the retag to touch.
    const gate = snapshot.components.find(component => component.name === "Gate");
    gate.fields = gate.fields.filter(field => field.name !== "lastOutput");

    const migrated = migrateSnapshot(snapshot);
    assert.equal(migrated.saveFormat, SAVE_FORMAT);
    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.snapshots.deserialize(migrated));
    assert.equal(restored.placed.eidsOf(BlenderType.typeId).length, 1);
});

test("a format-5 save drops the gate's and tank's last-synced columns and gains an empty Gate.lastOutput", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(GateDefinition.typeId, 6, 6, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(TankDefinition.typeId, 10, 10, Direction.UP));
    const snapshot = engine.snapshots.serialize();
    snapshot.saveFormat = 5;
    const gate = snapshot.components.find(component => component.name === "Gate");
    assert.equal(gate.rows.length, 1);
    gate.fields = gate.fields.filter(field => field.name !== "lastOutput");
    gate.fields.push({name: "lastOpen", kind: "i32"}, {name: "lastFluid", kind: "i32"});
    for (const row of gate.rows) {
        delete row.lastOutput;
        row.lastOpen = 1;
        row.lastFluid = 0;
    }
    const tank = snapshot.components.find(component => component.name === "Tank");
    assert.equal(tank.rows.length, 1);
    tank.fields.push({name: "lastType", kind: "item"});
    for (const row of tank.rows) {
        row.lastType = -1;
    }

    const migrated = migrateSnapshot(snapshot);
    const upgradedGate = migrated.components.find(component => component.name === "Gate");
    assert.ok(!upgradedGate.fields.some(field => field.name === "lastOpen" || field.name === "lastFluid"));
    assert.equal(upgradedGate.rows[0].lastOpen, undefined);
    assert.equal(upgradedGate.rows[0].lastFluid, undefined);
    assert.ok(upgradedGate.fields.some(field => field.name === "lastOutput" && field.kind === "item"));
    assert.equal(upgradedGate.rows[0].lastOutput, -1);
    const upgradedTank = migrated.components.find(component => component.name === "Tank");
    assert.ok(!upgradedTank.fields.some(field => field.name === "lastType"));
    assert.equal(upgradedTank.rows[0].lastType, undefined);

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.snapshots.deserialize(migrated));
    assert.equal(restored.placed.eidsOf(GateDefinition.typeId).length, 1);
    assert.equal(restored.placed.eidsOf(TankDefinition.typeId).length, 1);
});
