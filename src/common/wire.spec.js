import {test} from "node:test";
import assert from "node:assert";

import {ModRegistry} from "@/common/ModRegistry.js";
import {WireRegistry} from "@/common/wire.js";

import {SetViewportMessage} from "@/common/CoreMessages.js";
import {BufferedEvent} from "@/common/BufferedEvent.js";
import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent, GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";
import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent} from "@/common/CoreEvents.js";
import {chunkId} from "@/common/util.js";

// Core-only registry: common/ must not depend on mods/. AbstractMod wire classes are
// covered by their own specs (e.g. src/mods/Belt/wire.spec.js).
function registry() {
    return new WireRegistry(new ModRegistry());
}

/**
 * Reduces an object to its declared wire fields, mapping undefined → null so
 * absent-on-the-wire fields compare equal to the source.
 */
function pick(obj, cls) {
    const out = {};
    Object.keys(cls.wireFields).forEach(key => {
        out[key] = obj[key] === undefined ? null : obj[key];
    });
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

test("Round-trips a fully-populated BufferedEvent with BigInt fields", () => {
    const reg = registry();
    const event = new BufferedEvent({
        type: 3,
        id: 9999999999999999n, a: 8n, b: 0n, c: null,
    });
    roundTrip(reg, event, BufferedEvent);
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

test("Decoded BigInt id is an exact, lossless BigInt", () => {
    const reg = registry();
    const id = 9007199254740993n; // 2^53 + 1, beyond Number precision
    const decoded = reg.decode(reg.encode(new BufferedEvent({type: 0, id})));
    assert.strictEqual(typeof decoded.id, "bigint");
    assert.strictEqual(decoded.id, id);
});

test("Throws on an unregistered class", () => {
    const reg = registry();
    class Bogus {}
    assert.throws(() => reg.encode(new Bogus()), /No wire codec/);
});
