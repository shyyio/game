import {AbstractEvent} from "@/common/AbstractEvent.js";
import {chunkOrdinal} from "@/common/util.js";

/**
 * A buffered tick event, replayed to sessions whose viewport covers its chunk; `type` is
 * the discriminator. Its tile position is never sent — the client derives item positions
 * from the path — so only the routing chunk is kept, and only server-side (for the
 * immediate publishEventNow path; journaled events route via the SQL join).
 */
export class BufferedEvent extends AbstractEvent {

    static wireFields = {
        type: "int32",
        id: "int64?",
        a: "int64?",
        b: "int64?",
        c: "int64?",
    };

    /**
     * @param {object} row - Row from the BufferedEvent table, or an immediate publish
     * @param {number} row.type
     * @param {number} [row.routing_chunk_x] - chunk to route to (immediate publishes only)
     * @param {number} [row.routing_chunk_y]
     * @param {BigInt} [row.id]
     * @param {BigInt|number|null} [row.a]
     * @param {BigInt|number|null} [row.b]
     * @param {BigInt|number|null} [row.c]
     */
    constructor(row) {
        super();
        this.routingChunkX = row.routing_chunk_x;
        this.routingChunkY = row.routing_chunk_y;
        this.type = row.type;
        this.id = row.id;
        this.a = row.a;
        this.b = row.b;
        this.c = row.c;
    }

    /**
     * The ordinal chunk id to route to, matching the table's generated chunk column. Used by
     * publishEventNow for immediate publishes; journaled events route via the SQL join instead.
     * @returns {number}
     */
    get chunk() {
        return chunkOrdinal(this.routingChunkX, this.routingChunkY);
    }
}
