import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGameEngine} from "@/test/ecsSim.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {migrateSnapshot, SAVE_FORMAT} from "@/common/saveMigrations.js";
import {GAME_VERSION, Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {BlenderType} from "@/mods/BaseGame/common/objectTypes.js";

test("a fresh snapshot carries the current format and the writing version", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.serialize();

    assert.equal(snapshot.saveFormat, SAVE_FORMAT);
    assert.equal(snapshot.gameVersion, GAME_VERSION);
});

test("a snapshot already at the current format passes through untouched", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.serialize();

    assert.equal(migrateSnapshot(snapshot), snapshot);
});

test("an unstamped save is upgraded to the current format", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.serialize();
    delete snapshot.saveFormat;
    delete snapshot.gameVersion;

    const migrated = migrateSnapshot(snapshot);
    assert.equal(migrated.saveFormat, SAVE_FORMAT);
    assert.equal(migrated.gameVersion, null);

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.deserialize(migrated));
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
    const snapshot = engine.serialize();
    delete snapshot.saveFormat;

    const restored = await makeGameEngine();
    assert.throws(
        () => restored.deserialize(snapshot),
        /unstamped \(pre-dates save formats\)/,
    );
});

test("a format-2 save gains Machine.enabled, and every machine loads switched on", async () => {
    const engine = await makeGameEngine();
    assert.equal(engine.applyMessage(new CreateObjectMessage(BlenderType.typeId, 4, 4, Direction.UP)), true);
    const snapshot = engine.serialize();
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
    assert.doesNotThrow(() => restored.deserialize(migrated));
});

test("NodeSaveStore round-trips the format stamp", async () => {
    const engine = await makeGameEngine();
    const store = new NodeSaveStore(":memory:");
    await store.save(engine.serialize());
    const loaded = await store.load();

    assert.equal(loaded.saveFormat, SAVE_FORMAT);
    assert.equal(loaded.gameVersion, GAME_VERSION);
});

test("NodeSaveStore reads a save written before the stamp as unstamped", async () => {
    const engine = await makeGameEngine();
    const store = new NodeSaveStore(":memory:");
    await store.save(engine.serialize());
    store.db.exec('DROP TABLE "_Meta"');

    const loaded = await store.load();
    assert.equal(loaded.saveFormat, undefined);

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.deserialize(migrateSnapshot(loaded)));
});
