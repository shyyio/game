import {test} from "node:test";
import assert from "node:assert";

import {ModRegistry} from "@/common/mod/ModRegistry.js";
import {WireRegistry} from "@/common/wire.js";

import {SetViewportMessage, SetInspectedObjectsMessage} from "@/common/CoreMessages.js";
import {PortItemSetEvent, PortItemBatchEvent} from "@/common/PortItemEvents.js";
import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent, GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";
import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent} from "@/common/CoreEvents.js";
import {chunkId} from "@/common/util.js";

// Core-only registry: common/ must not depend on mods/. Mod wire classes are
// covered by their own specs (e.g. src/mods/Logistics/wire.spec.js).
function registry() {
    const modRegistry = new ModRegistry();
    modRegistry.freeze();
    return new WireRegistry(modRegistry);
}

/**
 * Reduces an object to its declared wire fields, mapping undefined → null so
 * absent-on-the-wire fields compare equal to the source.
 */
function pick(obj, cls) {
    const out = {};
    for (const key of Object.keys(cls.wireFields)) {
        out[key] = obj[key] === undefined ? null : obj[key];
    }
    return out;
}

function roundTrip(reg, instance, cls) {
    const decoded = reg.decode(reg.encode(instance));
    assert.ok(decoded instanceof cls, `decoded value is not a ${cls.name}`);
    assert.deepStrictEqual(pick(decoded, cls), pick(instance, cls));
}

test("Round-trips a SetViewportMessage", () => {
    const reg = registry();
    roundTrip(reg, new SetViewportMessage([0, 1, chunkId(-64, 128)]), SetViewportMessage);
});

test("Round-trips a PortItemSetEvent with a port id", () => {
    const reg = registry();
    roundTrip(reg, new PortItemSetEvent(12, -5, 999999999999, 8), PortItemSetEvent);
});

test("Round-trips a PortItemBatchEvent's packed columns", () => {
    const reg = registry();
    const batch = new PortItemBatchEvent(12, -5);
    batch.addClear(999999999999);
    batch.addSet(41, 8);
    batch.addSet(42, 0);
    roundTrip(reg, batch, PortItemBatchEvent);
});

test("Round-trips chunk subscribe/unsubscribe events, recovering the chunk id", () => {
    const reg = registry();
    const chunk = chunkId(128, -192);
    roundTrip(reg, new ChunkSubscribeEvent(chunk), ChunkSubscribeEvent);
    roundTrip(reg, new ChunkUnsubscribeEvent(chunk), ChunkUnsubscribeEvent);
    // The chunk id is wired directly.
    const decoded = reg.decode(reg.encode(new ChunkUnsubscribeEvent(chunk)));
    assert.strictEqual(decoded.chunk, chunk);
});

test("ChunkSyncEvent round-trips its bundle of polymorphic inner events", () => {
    const reg = registry();
    const chunk = chunkId(128, -192);
    const inner = [
        new ChunkSubscribeEvent(chunk),
        new GameSettingsUpdateEvent(7, 70),
    ];
    const decoded = reg.decode(reg.encode(new ChunkSyncEvent(chunk, inner)));

    assert.ok(decoded instanceof ChunkSyncEvent);
    assert.strictEqual(decoded.chunk, chunk);
    assert.strictEqual(decoded.events.length, 2);
    assert.ok(decoded.events[0] instanceof ChunkSubscribeEvent);
    assert.strictEqual(decoded.events[0].chunk, chunk);
    assert.ok(decoded.events[1] instanceof GameSettingsUpdateEvent);
    assert.strictEqual(decoded.events[1].key, 7);
    assert.strictEqual(decoded.events[1].value, 70);
});

test("Round-trips player/game settings events", () => {
    const reg = registry();
    roundTrip(reg, new PlayerSettingsSyncEvent({1: 10, 2: 20}), PlayerSettingsSyncEvent);
    roundTrip(reg, new PlayerSettingsUpdateEvent(5, 50), PlayerSettingsUpdateEvent);
    roundTrip(reg, new GameSettingsSyncEvent({3: 30}), GameSettingsSyncEvent);
    roundTrip(reg, new GameSettingsUpdateEvent(7, 70), GameSettingsUpdateEvent);
});

test("Decoded id is a Number, round-tripped exactly", () => {
    const reg = registry();
    const id = 999999999999;
    const decoded = reg.decode(reg.encode(new PortItemSetEvent(0, 0, id, 1)));
    assert.strictEqual(typeof decoded.portId, "number");
    assert.strictEqual(decoded.portId, id);
});

test("Repeated int64 decodes to Numbers, exact up to the 2^53 cap", () => {
    const reg = registry();
    const ids = [1, 999999999999, Number.MAX_SAFE_INTEGER];
    const decoded = reg.decode(reg.encode(new SetInspectedObjectsMessage(ids)));
    for (const id of decoded.objectIds) {
        assert.strictEqual(typeof id, "number");
    }
    assert.deepStrictEqual(decoded.objectIds, ids);
});

test("Throws on an unregistered class", () => {
    const reg = registry();
    class Bogus {}
    assert.throws(() => reg.encode(new Bogus()), /No wire codec/);
});
