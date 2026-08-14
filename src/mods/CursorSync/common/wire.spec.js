import {test} from "node:test";
import assert from "node:assert";

import {ModRegistry, ModPackage, WireRegistry, chunkId} from "@/sdk/common.js";
import {CursorSyncDeclaration} from "../declaration.js";
import {CursorMoveMessage, CursorHideMessage} from "./messages.js";
import {PlayerCursorEvent, PlayerCursorHideEvent} from "./events.js";

function registry() {
    const modRegistry = new ModRegistry();
    modRegistry.register(new ModPackage(new CursorSyncDeclaration()));
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

test("Round-trips the cursor messages and events", () => {
    const reg = registry();
    // Float32-exact fractions, so the wire round-trip compares equal.
    roundTrip(reg, new CursorMoveMessage(12.5, -3.25), CursorMoveMessage);
    roundTrip(reg, new CursorHideMessage(), CursorHideMessage);
    roundTrip(reg, new PlayerCursorEvent(7, 12.5, -3.25), PlayerCursorEvent);
    roundTrip(reg, new PlayerCursorHideEvent(7), PlayerCursorHideEvent);
    // The chunk is derived from the fractional tile position, never wired.
    const decoded = reg.decode(reg.encode(new PlayerCursorEvent(7, 12.5, -3.25)));
    assert.strictEqual(decoded.chunk, chunkId(12.5, -3.25));
});

test("Cursor move validation gates non-finite and out-of-region positions", () => {
    assert.strictEqual(new CursorMoveMessage(12.5, -3.25).validate(null, null), true);
    assert.strictEqual(new CursorMoveMessage(NaN, 0).validate(null, null), false);
    assert.strictEqual(new CursorMoveMessage(0, Infinity).validate(null, null), false);
    assert.strictEqual(new CursorMoveMessage(1e6, 0).validate(null, null), false);
});
