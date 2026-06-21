export class BufferedEvent {

    /**
     * @param {object} row - Row from the GameJournal table
     * @param {number} row.seq
     * @param {number} row.time
     * @param {number} row.type
     * @param {number} row.subtype
     * @param {number} row.x
     * @param {number} row.y
     * @param {string} row.chunk
     * @param {BigInt} row.id
     * @param {BigInt|number|null} row.a
     * @param {BigInt|number|null} row.b
     * @param {BigInt|number|null} row.c
     */
    constructor(row) {
        this.seq = row.seq;
        this.time = row.time;
        this.type = row.type;
        this.subtype = row.subtype;
        this.x = row.x;
        this.y = row.y;
        this.chunk = row.chunk;
        this.id = row.id;
        this.a = row.a;
        this.b = row.b;
        this.c = row.c;
    }
}
