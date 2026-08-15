import {test} from "node:test";
import assert from "node:assert/strict";
import {CHUNK_SIZE, chunkId} from "@spup/sdk";
import {Note} from "../common/Note.js";
import {NotesStore} from "./NotesStore.js";
import {NOTE_RECORD} from "../common/constants.js";

function note(tileX, tileY, authorId=1, text="hi") {
    return new Note(tileX, tileY, 250, 750, authorId, text);
}

test("a note is stored by tile and replaced in place", () => {
    const store = new NotesStore();
    store.set(note(3, 4));
    assert.equal(store.get(3, 4).text, "hi");
    assert.equal(store.get(4, 4), null);

    store.set(note(3, 4, 2, "mine now"));
    assert.equal(store.get(3, 4).text, "mine now");
    assert.equal(store.notesIn(chunkId(3, 4)).length, 1);
});

test("deleting a note drops it from the chunk index", () => {
    const store = new NotesStore();
    store.set(note(3, 4));
    assert.equal(store.delete(3, 4), true);
    assert.equal(store.delete(3, 4), false);
    assert.equal(store.get(3, 4), null);
    assert.deepEqual(store.notesIn(chunkId(3, 4)), []);
});

test("notes group by chunk with their authors", () => {
    const store = new NotesStore();
    store.set(note(3, 4, 1));
    store.set(note(5, 6, 2));
    store.set(note(3 + CHUNK_SIZE, 4, 3));

    const chunk = chunkId(3, 4);
    assert.equal(store.notesIn(chunk).length, 2);
    assert.deepEqual([...store.authorIdsIn(chunk)].sort(), [1, 2]);
    assert.deepEqual([...store.authorIdsIn(chunkId(3 + CHUNK_SIZE, 4))], [3]);
});

test("the record table round-trips every note", () => {
    const store = new NotesStore();
    store.set(note(3, 4, 1, "left"));
    store.set(note(-5, -6, 2, "right"));

    const tables = store.serializeRecords();
    assert.equal(tables.length, 1);
    assert.equal(tables[0].name, NOTE_RECORD);
    assert.equal(tables[0].rows.length, 2);

    const restored = new NotesStore();
    restored.deserializeRecords(tables[0]);
    assert.equal(restored.get(3, 4).text, "left");
    assert.equal(restored.get(-5, -6).authorId, 2);
    assert.equal(restored.get(-5, -6).offsetMx, 250);
    assert.equal(restored.notesIn(chunkId(-5, -6)).length, 1);
});

test("deserializing clears what stood before, a missing table included", () => {
    const store = new NotesStore();
    store.set(note(3, 4));

    store.deserializeRecords(undefined);
    assert.equal(store.get(3, 4), null);

    store.set(note(3, 4));
    store.deserializeRecords({name: NOTE_RECORD, fields: [], rows: []});
    assert.equal(store.get(3, 4), null);
    assert.deepEqual(store.notesIn(chunkId(3, 4)), []);
});
