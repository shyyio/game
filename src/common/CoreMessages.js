export const MESSAGE_SET_VIEWPORT = 0;

export class SetViewportMessage {

    static wireFields = {
        type: "int32",
        chunks: "string[]",
    };

    /**
     * @param {string[]} chunks
     */
    constructor(chunks) {
        this.type = MESSAGE_SET_VIEWPORT;
        this.chunks = chunks;
    }
}
