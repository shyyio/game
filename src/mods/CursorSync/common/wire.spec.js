import {test} from "node:test";
import assert from "node:assert";
import {wireRegistryFor, assertRoundTrip} from "@/test/wireRoundTrip.js";
import {chunkId} from "@spup/sdk";
import {CursorSyncDeclaration} from "../declaration.js";
import {CursorMoveMessage, CursorHideMessage} from "./messages.js";
import {PlayerCursorEvent, PlayerCursorHideEvent} from "./events.js";

test("Round-trips the cursor messages and events", () => {
    const reg = wireRegistryFor(new CursorSyncDeclaration());
    // Float32-exact fractions, so the wire round-trip compares equal.
    assertRoundTrip(reg, new CursorMoveMessage(12.5, -3.25), CursorMoveMessage);
    assertRoundTrip(reg, new CursorHideMessage(), CursorHideMessage);
    assertRoundTrip(reg, new PlayerCursorEvent(7, 12.5, -3.25), PlayerCursorEvent);
    assertRoundTrip(reg, new PlayerCursorHideEvent(7), PlayerCursorHideEvent);
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
