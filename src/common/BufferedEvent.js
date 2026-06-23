import {AbstractTilePositionedEvent} from "@/common/AbstractTilePositionedEvent.js";

/**
 * A journal-backed event: one row of the GameJournal event log, replayed to the
 * sessions whose viewport covers its chunk. Keeps `type` as the journal's own
 * event discriminator (other events carry none); `chunk` is derived from (x, y)
 * by AbstractTilePositionedEvent, so it is not a stored field.
 */
export class BufferedEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        seq: "int32",
        time: "int32",
        type: "int32",
        x: "int32?",
        y: "int32?",
        id: "int64?",
        a: "int64?",
        b: "int64?",
        c: "int64?",
    };

    /**
     * @param {object} row - Row from the GameJournal table
     * @param {number} row.seq
     * @param {number} row.time
     * @param {number} row.type
     * @param {number} [row.x]
     * @param {number} [row.y]
     * @param {BigInt} [row.id]
     * @param {BigInt|number|null} [row.a]
     * @param {BigInt|number|null} [row.b]
     * @param {BigInt|number|null} [row.c]
     */
    constructor(row) {
        super(row.x, row.y);
        this.seq = row.seq;
        this.time = row.time;
        this.type = row.type;
        this.id = row.id;
        this.a = row.a;
        this.b = row.b;
        this.c = row.c;
    }
}
