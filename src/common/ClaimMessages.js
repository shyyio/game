import {AbstractMessage} from "@/common/AbstractMessage.js";
import {REGION_SIZE} from "@/common/constants.js";

const CHUNK_ORDINAL_LIMIT = REGION_SIZE * REGION_SIZE;

/**
 * Base for messages targeting one chunk by ordinal; subclasses exist for wire identity.
 * @abstract
 */
class AbstractChunkMessage extends AbstractMessage {

    static wireFields = {
        chunk: "int32",
    };

    /**
     * @param {number} chunk
     */
    constructor(chunk) {
        super();
        this.chunk = chunk;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.chunk) && this.chunk >= 0 && this.chunk < CHUNK_ORDINAL_LIMIT;
    }
}

export class ClaimChunkMessage extends AbstractChunkMessage {
}

/**
 * Releases a claimed chunk; `clear` (0/1) confirms deleting every solid object still in it.
 */
export class UnclaimChunkMessage extends AbstractChunkMessage {

    static wireFields = {
        chunk: "int32",
        clear: "int32",
    };

    /**
     * @param {number} chunk
     * @param {boolean} [clear]
     */
    constructor(chunk, clear = false) {
        super(chunk);
        this.clear = clear ? 1 : 0;
    }
}
