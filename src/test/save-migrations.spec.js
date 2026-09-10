import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGameEngine, makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {chunkKeyAt} from "@/common/util.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {migrateSnapshot, SAVE_FORMAT} from "@/common/saveMigrations.js";
import {GAME_VERSION, Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {BlenderType} from "@/mods/base-game/common/objectTypes.js";
import {GateType, BeltType} from "@/mods/logistics/common/objectTypes.js";
import {TankType} from "@/mods/fluids/common/objectTypes.js";
import {TradingTerminalType} from "@/mods/market/common/objectTypes.js";

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
    assert.equal(engine.applyMessage(new CreateObjectMessage(BlenderType.objectTypeId, 4, 4, Direction.UP)), true);
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
    engine.applyMessage(new CreateObjectMessage(BlenderType.objectTypeId, 6, 6, Direction.UP));
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
    assert.equal(restored.placed.eidsOf(BlenderType.objectTypeId).length, 1);
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
    engine.applyMessage(new CreateObjectMessage(BlenderType.objectTypeId, 3, 3, Direction.UP));
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
    renameRowsBack(snapshot, "PlacedObject", "objectTypeId", "typeId");
    renameRowsBack(snapshot, "MarketTerminal", "itemTypeId", "itemType");

    const migrated = migrateSnapshot(snapshot);
    assert.equal(migrated.saveFormat, SAVE_FORMAT);
    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.snapshots.deserialize(migrated));
    assert.equal(restored.placed.eidsOf(BlenderType.objectTypeId).length, 1);
});

test("a format-5 save drops the gate's and tank's last-synced columns and gains an empty Gate.lastOutput", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(GateType.objectTypeId, 6, 6, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(TankType.objectTypeId, 10, 10, Direction.UP));
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
    assert.equal(restored.placed.eidsOf(GateType.objectTypeId).length, 1);
    assert.equal(restored.placed.eidsOf(TankType.objectTypeId).length, 1);
});

test("a format-6 save gains the empty lane components", async () => {
    const engine = await makeGameEngine();
    const snapshot = engine.snapshots.serialize();
    snapshot.saveFormat = 6;
    const laneNames = new Set(["Lane", "LaneCell", "LaneItem"]);
    snapshot.components = snapshot.components.filter(component => !laneNames.has(component.name));

    const migrated = migrateSnapshot(snapshot);

    assert.equal(migrated.saveFormat, SAVE_FORMAT);
    for (const name of laneNames) {
        const component = migrated.components.find(entry => entry.name === name);
        assert.ok(component !== undefined, `${name} is added`);
        assert.deepEqual(component.rows, [], `${name} comes back empty`);
    }
    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.snapshots.deserialize(migrated));
    assert.deepEqual(restored.lanes.ids(), []);
});

test("a format-7 save renames PlacedObject.typeId and MarketTerminal.itemType", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BlenderType.objectTypeId, 3, 3, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 8, 8, Direction.UP));
    const snapshot = engine.snapshots.serialize();
    snapshot.saveFormat = 7;
    renameRowsBack(snapshot, "PlacedObject", "objectTypeId", "typeId");
    renameRowsBack(snapshot, "MarketTerminal", "itemTypeId", "itemType");

    const migrated = migrateSnapshot(snapshot);

    const placed = migrated.components.find(component => component.name === "PlacedObject");
    assert.ok(placed.fields.some(field => field.name === "objectTypeId" && field.kind === "type"));
    assert.equal(placed.rows[0].typeId, undefined);
    assert.equal(placed.rows[0].objectTypeId, BlenderType.objectTypeId);
    const terminal = migrated.components.find(component => component.name === "MarketTerminal");
    assert.ok(terminal.fields.some(field => field.name === "itemTypeId" && field.kind === "item"));
    assert.equal(terminal.rows[0].itemType, undefined);

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.snapshots.deserialize(migrated));
    assert.equal(restored.placed.eidsOf(BlenderType.objectTypeId).length, 1);
});

/**
 * Puts one component's field back under its pre-format-8 name, in the field list and every row.
 * @param {object} snapshot
 * @param {string} componentName
 * @param {string} from
 * @param {string} to
 */
function renameRowsBack(snapshot, componentName, from, to) {
    const component = snapshot.components.find(entry => entry.name === componentName);
    for (const field of component.fields) {
        if (field.name === from) {
            field.name = to;
        }
    }
    for (const row of component.rows) {
        row[to] = row[from];
        delete row[from];
    }
}

test("a format-8 save renames every objectId column to objectRef", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BlenderType.objectTypeId, 3, 3, Direction.UP));
    const snapshot = engine.snapshots.serialize();
    snapshot.saveFormat = 8;
    renameRowsBack(snapshot, "PlacedObject", "objectRef", "objectId");
    renameRowsBack(snapshot, "PipeNetworkMember", "objectRef", "objectId");

    const migrated = migrateSnapshot(snapshot);

    for (const name of ["PlacedObject", "PipeNetworkMember"]) {
        const component = migrated.components.find(entry => entry.name === name);
        assert.ok(component.fields.some(field => field.name === "objectRef"), `${name} carries objectRef`);
        assert.ok(!component.fields.some(field => field.name === "objectId"), `${name} dropped objectId`);
    }
    const placed = migrated.components.find(component => component.name === "PlacedObject");
    assert.equal(placed.rows[0].objectId, undefined);
    assert.ok(placed.rows[0].objectRef > 0);

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.snapshots.deserialize(migrated));
    assert.equal(restored.placed.eidsOf(BlenderType.objectTypeId).length, 1);
});

test("a format-9 save renames the ChunkClaim record's chunk column to chunkKey", async () => {
    const game = await makeGame();
    const alice = game.players.getOrCreate("sub-alice", "alice");
    const session = new CapturingSession(alice.playerRef);
    game.connect(session);
    game.dispatchMessage(new ClaimChunkMessage(chunkKeyAt(0, 0)), session);
    const snapshot = game.serialize();
    snapshot.saveFormat = 9;
    const claims = snapshot.records.find(table => table.name === "ChunkClaim");
    for (const field of claims.fields) {
        if (field.name === "chunkKey") {
            field.name = "chunk";
        }
    }
    for (const row of claims.rows) {
        row.chunk = row.chunkKey;
        delete row.chunkKey;
    }

    const migrated = migrateSnapshot(snapshot);

    const upgraded = migrated.records.find(table => table.name === "ChunkClaim");
    assert.ok(upgraded.fields.some(field => field.name === "chunkKey"));
    assert.ok(!upgraded.fields.some(field => field.name === "chunk"));
    assert.equal(upgraded.rows[0].chunk, undefined);
    assert.equal(upgraded.rows[0].chunkKey, chunkKeyAt(0, 0));
});

// The belt path engine's three components as a format-10 save held them.
const BELT_PATH_COMPONENTS = [
    {
        name: "BeltPath",
        fields: [
            {name: "inPort", kind: "eid"},
            {name: "outPort", kind: "eid"},
            {name: "headGap", kind: "i32"},
            {name: "length", kind: "i32"},
        ],
    },
    {
        name: "BeltPathMember",
        fields: [{name: "path", kind: "eid"}, {name: "seq", kind: "i32"}, {name: "objectRef", kind: "i32"}],
    },
    {
        name: "BeltItem",
        fields: [
            {name: "path", kind: "eid"},
            {name: "seq", kind: "i32"},
            {name: "gap", kind: "i32"},
            {name: "type", kind: "item"},
        ],
    },
];

test("a format-10 save drops the belt path components and makes every belt a lane cell", async () => {
    const engine = await makeGameEngine();
    for (const y of [0, 1, 2]) {
        engine.applyMessage(new CreateObjectMessage(BeltType.objectTypeId, 0, y, Direction.UP));
    }
    engine.applyMessage(new CreateObjectMessage(BlenderType.objectTypeId, 5, 5, Direction.UP));
    const snapshot = engine.snapshots.serialize();
    snapshot.saveFormat = 10;
    for (const name of ["Lane", "LaneCell", "LaneItem"]) {
        snapshot.components.find(component => component.name === name).rows = [];
    }
    for (const component of BELT_PATH_COMPONENTS) {
        snapshot.components.push({name: component.name, fields: component.fields, rows: []});
    }
    const placed = snapshot.components.find(component => component.name === "PlacedObject");
    const beltEids = placed.rows
        .filter(row => row.objectTypeId === BeltType.objectTypeId)
        .map(row => row.eid);

    const migrated = migrateSnapshot(snapshot);

    assert.equal(migrated.saveFormat, SAVE_FORMAT);
    for (const component of BELT_PATH_COMPONENTS) {
        assert.equal(migrated.components.find(entry => entry.name === component.name), undefined, `${component.name} is dropped`);
    }
    const cells = migrated.components.find(component => component.name === "LaneCell");
    assert.deepEqual(
        cells.rows,
        beltEids.map(eid => ({eid, lane: -1, childCell: -1, parentEdge: 0})),
        "every belt becomes an unlinked lane cell",
    );

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.snapshots.deserialize(migrated));
    assert.equal(restored.lanes.ids().length, 1, "the belts re-derive into one lane");
    assert.equal(restored.lanes.cellsOf(restored.lanes.ids()[0]).length, 3);
});

test("a format-11 save renames the Lane port columns to inputPort and outputPort", async () => {
    const engine = await makeGameEngine();
    for (const y of [0, 1, 2]) {
        engine.applyMessage(new CreateObjectMessage(BeltType.objectTypeId, 0, y, Direction.UP));
    }
    const snapshot = engine.snapshots.serialize();
    snapshot.saveFormat = 11;
    renameRowsBack(snapshot, "Lane", "inputPort", "inPort");
    renameRowsBack(snapshot, "Lane", "outputPort", "outPort");

    const migrated = migrateSnapshot(snapshot);

    assert.equal(migrated.saveFormat, SAVE_FORMAT);
    const lane = migrated.components.find(component => component.name === "Lane");
    assert.deepEqual(lane.fields.map(field => field.name).filter(name => name.endsWith("Port")), ["inputPort", "outputPort"]);
    assert.equal(lane.rows[0].inPort, undefined);
    assert.ok(lane.rows[0].outputPort >= 0);

    const restored = await makeGameEngine();
    assert.doesNotThrow(() => restored.snapshots.deserialize(migrated));
    assert.equal(restored.lanes.cellsOf(restored.lanes.ids()[0]).length, 3);
});
