import {AbstractCacheWriter, ChunkUnsubscribeEvent, chunkId, schemaMap, schemaScalar, tileId} from "@spup/sdk/client";
import {NoteSetEvent, NoteDeleteEvent} from "../common/events.js";
import {Note} from "../common/Note.js";

export const NOTES_SCHEMA = {
    byTile: schemaMap(),
    editorTarget: schemaScalar(null),
    hoverTarget: schemaScalar(null),
};

// What the open editor panel does: write a new note, rewrite one's own, or remove someone else's
// from a chunk the player may build in.
export const NOTE_EDITOR_MODE_PLACE = 0;
export const NOTE_EDITOR_MODE_EDIT = 1;
export const NOTE_EDITOR_MODE_DELETE = 2;

/**
 * The note the editor panel is open for: a fresh anchor while placing, an existing note otherwise.
 */
export class NoteEditorTarget {

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} offsetMx sub-tile x offset, milli-tiles
     * @param {number} offsetMy sub-tile y offset, milli-tiles
     * @param {string} text
     * @param {number} mode a NOTE_EDITOR_MODE_* option
     * @param {number} authorId PLAYER_ID_NONE while placing a fresh note
     */
    constructor(
        tileX,
        tileY,
        offsetMx,
        offsetMy,
        text,
        mode,
        authorId,
    ) {
        this.tileX = tileX;
        this.tileY = tileY;
        this.offsetMx = offsetMx;
        this.offsetMy = offsetMy;
        this.text = text;
        this.mode = mode;
        this.authorId = authorId;
    }
}

/**
 * Feeds the "notes" namespace: the notes of the subscribed chunks plus the editor and hover
 * targets the HUD panel reads. Registered under "notes".
 */
export class NotesWriter extends AbstractCacheWriter {

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof NoteSetEvent) {
            const note = new Note(
                event.x,
                event.y,
                event.offsetMx,
                event.offsetMy,
                event.authorId,
                event.text,
            );
            this._state.mapSet("notes.byTile", tileId(event.x, event.y), note);
            const hoverTarget = this._state.get("notes.hoverTarget");
            // An edit lands while its own note is hovered; the panel must read the new text.
            if (hoverTarget !== null && hoverTarget.tileX === note.tileX && hoverTarget.tileY === note.tileY) {
                this._state.set("notes.hoverTarget", note);
            }
            return;
        }
        if (event instanceof NoteDeleteEvent) {
            this._state.mapDelete("notes.byTile", tileId(event.x, event.y));
            this._clearTargetsAt(event.x, event.y);
            return;
        }
        if (event instanceof ChunkUnsubscribeEvent) {
            this._state.mapDeleteWhere("notes.byTile", note => chunkId(note.tileX, note.tileY) === event.chunk);
            this._clearTargetsIn(event.chunk);
        }
    }

    /**
     * Opens the editor panel; nothing reaches the sim until it saves.
     * @param {NoteEditorTarget} target
     * @returns {void}
     */
    openEditor(target) {
        this._state.set("notes.editorTarget", target);
    }

    /**
     * @returns {void}
     */
    closeEditor() {
        this._state.set("notes.editorTarget", null);
    }

    /**
     * @param {Note|null} note the hovered note, null to clear
     * @returns {void}
     */
    setHover(note) {
        this._state.set("notes.hoverTarget", note);
    }

    /**
     * Drops an editor or hover target standing on a tile.
     * @private
     * @param {number} tileX
     * @param {number} tileY
     * @returns {void}
     */
    _clearTargetsAt(tileX, tileY) {
        this._clearTargetsWhere(target => target.tileX === tileX && target.tileY === tileY);
    }

    /**
     * Drops an editor or hover target standing in a chunk.
     * @private
     * @param {number} chunk
     * @returns {void}
     */
    _clearTargetsIn(chunk) {
        this._clearTargetsWhere(target => chunkId(target.tileX, target.tileY) === chunk);
    }

    /**
     * @private
     * @param {function(Note|NoteEditorTarget): boolean} predicate
     * @returns {void}
     */
    _clearTargetsWhere(predicate) {
        const editorTarget = this._state.get("notes.editorTarget");
        if (editorTarget !== null && predicate(editorTarget)) {
            this._state.set("notes.editorTarget", null);
        }
        const hoverTarget = this._state.get("notes.hoverTarget");
        if (hoverTarget !== null && predicate(hoverTarget)) {
            this._state.set("notes.hoverTarget", null);
        }
    }
}
