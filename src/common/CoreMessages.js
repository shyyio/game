import {AbstractMessage} from "@/common/AbstractMessage.js";

const MAX_VIEWPORT_CHUNKS = 256;

export class SetViewportMessage extends AbstractMessage {

    static wireFields = {
        chunks: "string[]",
    };

    /**
     * @param {string[]} chunks
     */
    constructor(chunks) {
        super();
        this.chunks = chunks;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return this.chunks.length <= MAX_VIEWPORT_CHUNKS;
    }
}
