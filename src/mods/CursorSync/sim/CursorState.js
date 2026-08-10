/**
 * A session's published cursor: its owner and the chunk it was last seen in, for targeted hides.
 */
export class CursorState {

    /**
     * @param {number} playerId
     * @param {number} chunk
     */
    constructor(playerId, chunk) {
        this.playerId = playerId;
        this.chunk = chunk;
    }
}
