import {test} from "node:test";
import assert from "node:assert/strict";
import {ChunkUnsubscribeEvent, ClientCache, PLAYER_ID_NONE, chunkId, tileId} from "@spup/sdk/client";
import {NOTES_SCHEMA, NOTE_EDITOR_MODE_EDIT, NOTE_EDITOR_MODE_PLACE, NoteEditorTarget, NotesWriter} from "./NotesState.js";
import {NoteSetEvent, NoteDeleteEvent} from "../common/events.js";

function stateWithNotes() {
    const state = new ClientCache();
    state.register("notes", NOTES_SCHEMA, new NotesWriter(state));
    return state;
}

test("a set event writes the note, an edit replaces it", () => {
    const state = stateWithNotes();
    state.onEvent(new NoteSetEvent(3, 4, 250, 750, 7, "first"));
    const note = state.mapGet("notes.byTile", tileId(3, 4));
    assert.equal(note.text, "first");
    assert.equal(note.offsetMx, 250);
    assert.equal(note.authorId, 7);

    state.onEvent(new NoteSetEvent(3, 4, 250, 750, 7, "second"));
    assert.equal(state.mapGet("notes.byTile", tileId(3, 4)).text, "second");
});

test("an edit refreshes the hovered note", () => {
    const state = stateWithNotes();
    state.onEvent(new NoteSetEvent(3, 4, 0, 0, 7, "first"));
    state.writer("notes").setHover(state.mapGet("notes.byTile", tileId(3, 4)));

    state.onEvent(new NoteSetEvent(3, 4, 0, 0, 7, "second"));
    assert.equal(state.get("notes.hoverTarget").text, "second");
});

test("a delete drops the note and any target standing on it", () => {
    const state = stateWithNotes();
    state.onEvent(new NoteSetEvent(3, 4, 0, 0, 7, "first"));
    const writer = state.writer("notes");
    writer.setHover(state.mapGet("notes.byTile", tileId(3, 4)));
    writer.openEditor(new NoteEditorTarget(3, 4, 0, 0, "first", NOTE_EDITOR_MODE_EDIT, 7));

    state.onEvent(new NoteDeleteEvent(3, 4));
    assert.equal(state.mapGet("notes.byTile", tileId(3, 4)), undefined);
    assert.equal(state.get("notes.hoverTarget"), null);
    assert.equal(state.get("notes.editorTarget"), null);
});

test("a delete elsewhere leaves the open targets alone", () => {
    const state = stateWithNotes();
    state.onEvent(new NoteSetEvent(3, 4, 0, 0, 7, "first"));
    state.onEvent(new NoteSetEvent(5, 6, 0, 0, 7, "second"));
    const writer = state.writer("notes");
    writer.openEditor(new NoteEditorTarget(3, 4, 0, 0, "first", NOTE_EDITOR_MODE_EDIT, 7));

    state.onEvent(new NoteDeleteEvent(5, 6));
    assert.equal(state.get("notes.editorTarget").tileX, 3);
});

test("unsubscribing a chunk evicts its notes and targets", () => {
    const state = stateWithNotes();
    state.onEvent(new NoteSetEvent(3, 4, 0, 0, 7, "here"));
    state.onEvent(new NoteSetEvent(1000, 1000, 0, 0, 7, "far away"));
    const writer = state.writer("notes");
    writer.setHover(state.mapGet("notes.byTile", tileId(3, 4)));

    state.onEvent(new ChunkUnsubscribeEvent(chunkId(3, 4)));
    assert.equal(state.mapGet("notes.byTile", tileId(3, 4)), undefined);
    assert.equal(state.mapGet("notes.byTile", tileId(1000, 1000)).text, "far away");
    assert.equal(state.get("notes.hoverTarget"), null);
});

test("the editor target opens and closes without touching the notes", () => {
    const state = stateWithNotes();
    const writer = state.writer("notes");
    writer.openEditor(new NoteEditorTarget(3, 4, 500, 500, "", NOTE_EDITOR_MODE_PLACE, PLAYER_ID_NONE));
    assert.equal(state.get("notes.editorTarget").mode, NOTE_EDITOR_MODE_PLACE);

    writer.closeEditor();
    assert.equal(state.get("notes.editorTarget"), null);
});
