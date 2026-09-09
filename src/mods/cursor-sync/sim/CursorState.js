/**
 * A session's published cursor: its owner and the chunk it was last seen in, for targeted hides.
 */
export class CursorState {

    /**
     * @param {number} playerRef
     * @param {number} chunkKey
     */
    constructor(playerRef, chunkKey) {
        this.playerRef = playerRef;
        this.chunkKey = chunkKey;
    }
}
