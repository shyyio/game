export class BufferedEvent {

    static wireFields = {
        seq: "int32",
        time: "int32",
        type: "int32",
        subtype: "int32",
        x: "int32?",
        y: "int32?",
        chunk: "string?",
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
     * @param {number} row.subtype
     * @param {number} [row.x]
     * @param {number} [row.y]
     * @param {string} [row.chunk]
     * @param {BigInt} [row.id]
     * @param {BigInt|number|null} [row.a]
     * @param {BigInt|number|null} [row.b]
     * @param {BigInt|number|null} [row.c]
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
