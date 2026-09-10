import {test} from "node:test";
import assert from "node:assert/strict";
import {CHUNK_SIZE, chunkKeyAt} from "@spup/sdk";
import {Note} from "../common/Note.js";
import {NotesStore} from "./NotesStore.js";
import {NOTE_TABLE} from "../common/constants.js";

function note(tileX, tileY, authorRef=1, text="hi") {
    return new Note(tileX, tileY, 250, 750, authorRef, text);
}

test("a note is stored by tile and replaced in place", () => {
    const store = new NotesStore();
    store.set(note(3, 4));
    assert.equal(store.getNoteAtOrNull(3, 4).text, "hi");
    assert.equal(store.getNoteAtOrNull(4, 4), null);

    store.set(note(3, 4, 2, "mine now"));
    assert.equal(store.getNoteAtOrNull(3, 4).text, "mine now");
    assert.equal(store.getNotesByChunkKey(chunkKeyAt(3, 4)).length, 1);
});

test("deleting a note drops it from the chunk index", () => {
    const store = new NotesStore();
    store.set(note(3, 4));
    assert.equal(store.delete(3, 4), true);
    assert.equal(store.delete(3, 4), false);
    assert.equal(store.getNoteAtOrNull(3, 4), null);
    assert.deepEqual(store.getNotesByChunkKey(chunkKeyAt(3, 4)), []);
});

test("notes group by chunk with their authors", () => {
    const store = new NotesStore();
    store.set(note(3, 4, 1));
    store.set(note(5, 6, 2));
    store.set(note(3 + CHUNK_SIZE, 4, 3));

    const chunkKey = chunkKeyAt(3, 4);
    assert.equal(store.getNotesByChunkKey(chunkKey).length, 2);
    assert.deepEqual(Array.from(store.getAuthorIdsByChunkKey(chunkKey)).sort(), [1, 2]);
    assert.deepEqual(Array.from(store.getAuthorIdsByChunkKey(chunkKeyAt(3 + CHUNK_SIZE, 4))), [3]);
});

test("the table round-trips every note", () => {
    const store = new NotesStore();
    store.set(note(3, 4, 1, "left"));
    store.set(note(-5, -6, 2, "right"));

    const tables = store.serializeTables();
    assert.equal(tables.length, 1);
    assert.equal(tables[0].name, NOTE_TABLE);
    assert.equal(tables[0].rows.length, 2);

    const restored = new NotesStore();
    restored.deserializeTables(tables[0]);
    assert.equal(restored.getNoteAtOrNull(3, 4).text, "left");
    assert.equal(restored.getNoteAtOrNull(-5, -6).authorRef, 2);
    assert.equal(restored.getNoteAtOrNull(-5, -6).offsetMx, 250);
    assert.equal(restored.getNotesByChunkKey(chunkKeyAt(-5, -6)).length, 1);
});

test("deserializing clears what stood before, a missing table included", () => {
    const store = new NotesStore();
    store.set(note(3, 4));

    store.deserializeTables(undefined);
    assert.equal(store.getNoteAtOrNull(3, 4), null);

    store.set(note(3, 4));
    store.deserializeTables({name: NOTE_TABLE, fields: [], rows: []});
    assert.equal(store.getNoteAtOrNull(3, 4), null);
    assert.deepEqual(store.getNotesByChunkKey(chunkKeyAt(3, 4)), []);
});
