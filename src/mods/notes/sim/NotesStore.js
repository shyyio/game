import {AbstractSystem, chunkKeyAt, getOrCreate, removeFromGroup, tileKeyAt} from "@spup/sdk";
import {NOTE_TABLE} from "../common/constants.js";
import {Note} from "../common/Note.js";
import {NoteSetEvent} from "../common/events.js";

/**
 * Every placed note, keyed by tile and grouped by chunk. Pure state: it neither publishes nor
 * gates, so the sim mod owns permissions and fan-out.
 */
export class NotesStore extends AbstractSystem {

    constructor() {
        super();
        /**
         * @type {Map<number, Note>}
         */
        this._byTile = new Map();
        /**
         * @type {Map<number, Set<number>>}
         */
        this._tilesByChunk = new Map();
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @returns {Note|null}
     */
    findNoteAt(tileX, tileY) {
        const note = this._byTile.get(tileKeyAt(tileX, tileY));
        if (note === undefined) {
            return null;
        }
        return note;
    }

    /**
     * Places a note, replacing whatever stood on its tile.
     * @param {Note} note
     * @returns {void}
     */
    set(note) {
        const tile = tileKeyAt(note.tileX, note.tileY);
        this._byTile.set(tile, note);
        getOrCreate(this._tilesByChunk, chunkKeyAt(note.tileX, note.tileY), () => new Set()).add(tile);
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @returns {boolean} whether a note stood there
     */
    delete(tileX, tileY) {
        const tile = tileKeyAt(tileX, tileY);
        if (!this._byTile.delete(tile)) {
            return false;
        }
        removeFromGroup(this._tilesByChunk, chunkKeyAt(tileX, tileY), tile);
        return true;
    }

    /**
     * @param {number} chunkKey
     * @returns {Note[]}
     */
    getNotesByChunkKey(chunkKey) {
        const tiles = this._tilesByChunk.get(chunkKey);
        if (tiles === undefined) {
            return [];
        }
        const notes = [];
        for (const tile of tiles) {
            notes.push(this._byTile.get(tile));
        }
        return notes;
    }

    /**
     * @param {number} chunkKey
     * @returns {Set<number>} the players authoring the chunk's notes
     */
    getAuthorIdsByChunkKey(chunkKey) {
        const authorIds = new Set();
        const tiles = this._tilesByChunk.get(chunkKey);
        if (tiles === undefined) {
            return authorIds;
        }
        for (const tile of tiles) {
            authorIds.add(this._byTile.get(tile).authorRef);
        }
        return authorIds;
    }

    /**
     * @returns {object[]} the Note table
     */
    serializeTables() {
        const rows = [];
        for (const note of this._byTile.values()) {
            rows.push({
                tileX: note.tileX,
                tileY: note.tileY,
                offsetMx: note.offsetMx,
                offsetMy: note.offsetMy,
                authorRef: note.authorRef,
                text: note.text,
            });
        }
        return [
            {
                name: NOTE_TABLE,
                fields: [
                    {name: "tileX", kind: "integer"},
                    {name: "tileY", kind: "integer"},
                    {name: "offsetMx", kind: "integer"},
                    {name: "offsetMy", kind: "integer"},
                    {name: "authorRef", kind: "integer"},
                    {name: "text", kind: "text"},
                ],
                rows: rows,
            },
        ];
    }

    /**
     * @param {object|undefined} table - the Note table; undefined clears
     * @returns {void}
     */
    deserializeTables(table) {
        this._byTile.clear();
        this._tilesByChunk.clear();
        if (table === undefined) {
            return;
        }
        for (const row of table.rows) {
            this.set(new Note(
                row.tileX,
                row.tileY,
                row.offsetMx,
                row.offsetMy,
                row.authorRef,
                row.text,
            ));
        }
    }

    chunkSync(chunkKey) {
        return this.getNotesByChunkKey(chunkKey).map(note => new NoteSetEvent(
            note.tileX,
            note.tileY,
            note.offsetMx,
            note.offsetMy,
            note.authorRef,
            note.text,
        ));
    }
}
