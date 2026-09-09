/**
 * A session's published cursor: its owner and the chunk it was last seen in, for targeted hides.
 */
export class CursorState {

    /**
     * @param {number} playerRef
     * @param {number} chunk
     */
    constructor(playerRef, chunk) {
        this.playerRef = playerRef;
        this.chunk = chunk;
    }
}
