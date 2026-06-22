import {test} from "node:test";
import assert from "node:assert";

import {ModRegistry} from "@/common/ModRegistry.js";
import {WireRegistry} from "@/common/wire.js";

import {SetViewportMessage} from "@/common/CoreMessages.js";
import {BufferedEvent} from "@/common/BufferedEvent.js";
import {PlayerSettingsSyncEvent, PlayerSettingUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent, GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";

// Core-only registry: common/ must not depend on mods/. Mod wire classes are
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

test("round-trips a SetViewportMessage", () => {
    const reg = registry();
    roundTrip(reg, new SetViewportMessage(["0_0", "1_0", "-1_2"]), SetViewportMessage);
});

test("round-trips a fully-populated BufferedEvent with BigInt fields", () => {
    const reg = registry();
    const event = new BufferedEvent({
        seq: 1, time: 2, type: 3, subtype: 0, x: 5, y: 6, chunk: "0_0",
        id: 9999999999999999n, a: 8n, b: 0n, c: null,
    });
    roundTrip(reg, event, BufferedEvent);
});

test("round-trips a sparse core BufferedEvent (chunk subscribe shape)", () => {
    const reg = registry();
    const event = new BufferedEvent({type: 0, subtype: 1, chunk: "2_-3"});
    roundTrip(reg, event, BufferedEvent);
});

test("round-trips player/game settings events", () => {
    const reg = registry();
    roundTrip(reg, new PlayerSettingsSyncEvent({1: 10, 2: 20}), PlayerSettingsSyncEvent);
    roundTrip(reg, new PlayerSettingUpdateEvent(5, 50), PlayerSettingUpdateEvent);
    roundTrip(reg, new GameSettingsSyncEvent({3: 30}), GameSettingsSyncEvent);
    roundTrip(reg, new GameSettingsUpdateEvent(7, 70), GameSettingsUpdateEvent);
});

test("decoded BigInt id is an exact, lossless BigInt", () => {
    const reg = registry();
    const id = 9007199254740993n; // 2^53 + 1, beyond Number precision
    const decoded = reg.decode(reg.encode(new BufferedEvent({type: 0, id})));
    assert.strictEqual(typeof decoded.id, "bigint");
    assert.strictEqual(decoded.id, id);
});

test("throws on an unregistered class", () => {
    const reg = registry();
    class Bogus {}
    assert.throws(() => reg.encode(new Bogus()), /No wire codec/);
});
