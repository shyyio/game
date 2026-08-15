import {test} from "node:test";
import assert from "node:assert";

import {ModRegistry, ModPackage, WireRegistry, chunkId} from "@spup/sdk";
import {NotesDeclaration} from "../declaration.js";
import {NotePlaceMessage, NoteEditMessage, NoteDeleteMessage} from "./messages.js";
import {NoteSetEvent, NoteDeleteEvent} from "./events.js";
import {NOTE_TEXT_MAX_LENGTH} from "./constants.js";

function registry() {
    const modRegistry = new ModRegistry();
    modRegistry.register(new ModPackage(new NotesDeclaration()));
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

test("Round-trips the note messages and events", () => {
    const reg = registry();
    roundTrip(reg, new NotePlaceMessage(12, -3, 250, 999, "watch this belt"), NotePlaceMessage);
    roundTrip(reg, new NoteEditMessage(12, -3, "watch that belt"), NoteEditMessage);
    roundTrip(reg, new NoteDeleteMessage(12, -3), NoteDeleteMessage);
    roundTrip(reg, new NoteSetEvent(12, -3, 250, 999, 7, "watch this belt"), NoteSetEvent);
    roundTrip(reg, new NoteDeleteEvent(12, -3), NoteDeleteEvent);
    // The chunk is derived from the tile position, never wired.
    const decoded = reg.decode(reg.encode(new NoteSetEvent(12, -3, 250, 999, 7, "hi")));
    assert.strictEqual(decoded.chunk, chunkId(12, -3));
});

test("Note placement validation gates positions, offsets, and text", () => {
    assert.strictEqual(new NotePlaceMessage(12, -3, 0, 999, "hi").validate(null, null), true);
    assert.strictEqual(new NotePlaceMessage(12.5, -3, 0, 0, "hi").validate(null, null), false);
    assert.strictEqual(new NotePlaceMessage(1e9, -3, 0, 0, "hi").validate(null, null), false);
    assert.strictEqual(new NotePlaceMessage(12, -3, -1, 0, "hi").validate(null, null), false);
    assert.strictEqual(new NotePlaceMessage(12, -3, 1000, 0, "hi").validate(null, null), false);
    assert.strictEqual(new NotePlaceMessage(12, -3, 0, 0, "").validate(null, null), false);
    assert.strictEqual(new NotePlaceMessage(12, -3, 0, 0, "x".repeat(NOTE_TEXT_MAX_LENGTH)).validate(null, null), true);
    assert.strictEqual(new NotePlaceMessage(12, -3, 0, 0, "x".repeat(NOTE_TEXT_MAX_LENGTH + 1)).validate(null, null), false);
    assert.strictEqual(new NotePlaceMessage(12, -3, 0, 0, "two\nlines").validate(null, null), false);
    assert.strictEqual(new NotePlaceMessage(12, -3, 0, 0, 5).validate(null, null), false);
});

test("Note edit and delete validation gates positions and text", () => {
    assert.strictEqual(new NoteEditMessage(12, -3, "hi").validate(null, null), true);
    assert.strictEqual(new NoteEditMessage(12, -3, "").validate(null, null), false);
    assert.strictEqual(new NoteDeleteMessage(12, -3).validate(null, null), true);
    assert.strictEqual(new NoteDeleteMessage(12.5, -3).validate(null, null), false);
});
