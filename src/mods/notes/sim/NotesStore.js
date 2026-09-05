import {chunkId, getOrCreate, removeFromGroup, tileId} from "@spup/sdk";
import {NOTE_RECORD} from "../common/constants.js";
import {Note} from "../common/Note.js";

/**
 * Every placed note, keyed by tile and grouped by chunk. Pure state: it neither publishes nor
 * gates, so the sim mod owns permissions and fan-out.
 */
export class NotesStore {

    constructor() {
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
    get(tileX, tileY) {
        const note = this._byTile.get(tileId(tileX, tileY));
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
        const tile = tileId(note.tileX, note.tileY);
        this._byTile.set(tile, note);
        getOrCreate(this._tilesByChunk, chunkId(note.tileX, note.tileY), () => new Set()).add(tile);
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @returns {boolean} whether a note stood there
     */
    delete(tileX, tileY) {
        const tile = tileId(tileX, tileY);
        if (!this._byTile.delete(tile)) {
            return false;
        }
        removeFromGroup(this._tilesByChunk, chunkId(tileX, tileY), tile);
        return true;
    }

    /**
     * @param {number} chunk
     * @returns {Note[]}
     */
    notesIn(chunk) {
        const tiles = this._tilesByChunk.get(chunk);
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
     * @param {number} chunk
     * @returns {Set<number>} the players authoring the chunk's notes
     */
    authorIdsIn(chunk) {
        const authorIds = new Set();
        const tiles = this._tilesByChunk.get(chunk);
        if (tiles === undefined) {
            return authorIds;
        }
        for (const tile of tiles) {
            authorIds.add(this._byTile.get(tile).authorId);
        }
        return authorIds;
    }

    /**
     * @returns {object[]} the Note record table
     */
    serializeRecords() {
        const rows = [];
        for (const note of this._byTile.values()) {
            rows.push({
                tile_x: note.tileX,
                tile_y: note.tileY,
                offset_mx: note.offsetMx,
                offset_my: note.offsetMy,
                author_id: note.authorId,
                text: note.text,
            });
        }
        return [
            {
                name: NOTE_RECORD,
                fields: [
                    {name: "tile_x", kind: "integer"},
                    {name: "tile_y", kind: "integer"},
                    {name: "offset_mx", kind: "integer"},
                    {name: "offset_my", kind: "integer"},
                    {name: "author_id", kind: "integer"},
                    {name: "text", kind: "text"},
                ],
                rows: rows,
            },
        ];
    }

    /**
     * @param {object|undefined} table - the Note record table; undefined clears
     * @returns {void}
     */
    deserializeRecords(table) {
        this._byTile.clear();
        this._tilesByChunk.clear();
        if (table === undefined) {
            return;
        }
        for (const row of table.rows) {
            this.set(new Note(
                row.tile_x,
                row.tile_y,
                row.offset_mx,
                row.offset_my,
                row.author_id,
                row.text,
            ));
        }
    }
}
