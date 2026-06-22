import {Message} from "@/common/Message.js";

const MESSAGE_SET_VIEWPORT = 0;

const MAX_VIEWPORT_CHUNKS = 256;

export class SetViewportMessage extends Message {

    static wireFields = {
        type: "int32",
        chunks: "string[]",
    };

    /**
     * @param {string[]} chunks
     */
    constructor(chunks) {
        super();
        this.type = MESSAGE_SET_VIEWPORT;
        this.chunks = chunks;
    }

    /**
     * @param {GameAPI} api
     * @param {Session} session
     * @returns {boolean}
     */
    validate(api, session) {
        return this.chunks.length <= MAX_VIEWPORT_CHUNKS;
    }
}
