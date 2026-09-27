import {test} from "node:test";
import assert from "node:assert";
import {wireRegistryFor, assertRoundTrip} from "@/test/wireRoundTrip.js";
import {chunkKeyAt, Blueprint, BlueprintEntry, Direction, ModRegistry} from "@spup/sdk";
import {PASTE_FIXTURE_PACKAGE, PasteSquareType, PasteTileType} from "../pasteFixture.js";
import {CursorSyncDeclaration} from "../declaration.js";
import {MAX_PASTE_CELLS} from "./constants.js";
import {CursorMoveMessage, CursorHideMessage, CursorSelectionStartMessage, CursorSelectionEndMessage, CursorPasteMessage, CursorPasteClearMessage} from "./messages.js";
import {PlayerCursorEvent, PlayerCursorHideEvent, PlayerSelectionStartEvent, PlayerSelectionEndEvent, PlayerPasteEvent, PlayerPasteClearEvent} from "./events.js";

function pasteRegistry() {
    const modRegistry = new ModRegistry();
    modRegistry.register(PASTE_FIXTURE_PACKAGE);
    modRegistry.freeze();
    return modRegistry;
}

test("Round-trips the cursor messages and events", () => {
    const reg = wireRegistryFor(new CursorSyncDeclaration());
    // Float32-exact fractions, so the wire round-trip compares equal.
    assertRoundTrip(reg, new CursorMoveMessage(12.5, -3.25), CursorMoveMessage);
    assertRoundTrip(reg, new CursorHideMessage(), CursorHideMessage);
    assertRoundTrip(reg, new PlayerCursorEvent(7, 12.5, -3.25), PlayerCursorEvent);
    assertRoundTrip(reg, new PlayerCursorHideEvent(7), PlayerCursorHideEvent);
    // The chunk is derived from the fractional tile position, never wired.
    const decoded = reg.decode(reg.encode(new PlayerCursorEvent(7, 12.5, -3.25)));
    assert.strictEqual(decoded.chunkKey, chunkKeyAt(12.5, -3.25));
});

test("Cursor move validation gates non-finite and out-of-region positions", () => {
    assert.strictEqual(new CursorMoveMessage(12.5, -3.25).validate(null, null), true);
    assert.strictEqual(new CursorMoveMessage(NaN, 0).validate(null, null), false);
    assert.strictEqual(new CursorMoveMessage(0, Infinity).validate(null, null), false);
    assert.strictEqual(new CursorMoveMessage(1e6, 0).validate(null, null), false);
});

test("Round-trips the selection messages and events", () => {
    const reg = wireRegistryFor(new CursorSyncDeclaration());
    assertRoundTrip(reg, new CursorSelectionStartMessage(12.5, -3.25, 40), CursorSelectionStartMessage);
    assertRoundTrip(reg, new CursorSelectionEndMessage(), CursorSelectionEndMessage);
    assertRoundTrip(reg, new PlayerSelectionStartEvent(7, 12.5, -3.25, 40), PlayerSelectionStartEvent);
    assertRoundTrip(reg, new PlayerSelectionEndEvent(7), PlayerSelectionEndEvent);
});

test("Selection start validation gates non-finite and out-of-region corners", () => {
    assert.strictEqual(new CursorSelectionStartMessage(12.5, -3.25, 40).validate(null, null), true);
    assert.strictEqual(new CursorSelectionStartMessage(NaN, 0, 40).validate(null, null), false);
    assert.strictEqual(new CursorSelectionStartMessage(0, 1e6, 40).validate(null, null), false);
});

test("A paste mask is the footprints' row runs over their bounds", () => {
    const modRegistry = pasteRegistry();
    // XX.
    // XXX, offset by the bounds' corner.
    const blueprint = new Blueprint([
        new BlueprintEntry(PasteSquareType.objectTypeId, -1, -1, Direction.UP),
        new BlueprintEntry(PasteTileType.objectTypeId, 1, 0, Direction.UP),
    ]);
    const message = new CursorPasteMessage(blueprint, modRegistry);
    assert.strictEqual(message.tileWidth, 3);
    assert.deepStrictEqual(message.runs, [0, 2, 1, 3]);
});

test("Round-trips the paste messages and events", () => {
    const reg = wireRegistryFor(new CursorSyncDeclaration());
    const blueprint = new Blueprint([new BlueprintEntry(PasteSquareType.objectTypeId, 0, 0, Direction.UP)]);
    assertRoundTrip(reg, new CursorPasteMessage(blueprint, pasteRegistry()), CursorPasteMessage);
    assertRoundTrip(reg, new CursorPasteClearMessage(), CursorPasteClearMessage);
    assertRoundTrip(reg, new PlayerPasteEvent(7, 3, [0, 2, 1, 3]), PlayerPasteEvent);
    assertRoundTrip(reg, new PlayerPasteClearEvent(7), PlayerPasteClearEvent);
});

test("Paste validation gates malformed and oversized masks", () => {
    const paste = (tileWidth, runs) => Object.assign(Object.create(CursorPasteMessage.prototype), {tileWidth, runs});
    assert.strictEqual(paste(3, [0, 2, 1, 3]).validate(null, null), true);
    assert.strictEqual(paste(0, [0, 2]).validate(null, null), false, "no width");
    assert.strictEqual(paste(3, []).validate(null, null), false, "no cells");
    assert.strictEqual(paste(3, [0, 2, 1]).validate(null, null), false, "odd run count");
    assert.strictEqual(paste(3, [-1, 2]).validate(null, null), false, "negative run");
    assert.strictEqual(paste(3, [0, 2, 1, 0]).validate(null, null), false, "empty filled run");
    assert.strictEqual(paste(3, [0, MAX_PASTE_CELLS + 1]).validate(null, null), false, "too many cells");
});

test("A paste mask reads back as per-row runs, split where a run wraps", () => {
    assert.deepStrictEqual(new PlayerPasteEvent(7, 3, [0, 2, 1, 3]).getRowRuns(), [
        {tileX: 0, tileY: 0, tileLength: 2},
        {tileX: 0, tileY: 1, tileLength: 3},
    ]);
    assert.deepStrictEqual(new PlayerPasteEvent(7, 3, [2, 3]).getRowRuns(), [
        {tileX: 2, tileY: 0, tileLength: 1},
        {tileX: 0, tileY: 1, tileLength: 2},
    ]);
    assert.strictEqual(new PlayerPasteEvent(7, 3, [2, 3]).tileHeight, 2);
});
