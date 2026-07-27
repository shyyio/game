import {AbstractEvent} from "@/common/AbstractEvent.js";
import {AbstractBroadcastEvent} from "@/common/AbstractBroadcastEvent.js";

/**
 * A claim/unclaim attempt's outcome, carried by ClaimResultEvent.
 * @enum
 */
export const ClaimResult = {
    CLAIM_RESULT_OK: 1,
    CLAIM_RESULT_OWNED: 2,
    CLAIM_RESULT_LIMIT: 3,
    CLAIM_RESULT_NOT_ADJACENT: 4,
    CLAIM_RESULT_NOT_OWNER: 5,
    CLAIM_RESULT_WOULD_SPLIT: 6,
};

/**
 * The full chunk-ownership map as parallel arrays, sent to a session on connect. Targeted
 * (publishTo).
 */
export class ChunkClaimSyncEvent extends AbstractEvent {

    static wireFields = {
        chunks: "int32[]",
        playerIds: "int64[]",
    };

    /**
     * @param {number[]} chunks
     * @param {number[]} playerIds
     */
    constructor(chunks, playerIds) {
        super();
        this.chunks = chunks;
        this.playerIds = playerIds;
    }
}

/**
 * One chunk's ownership changed; playerId PLAYER_ID_NONE means it is now unclaimed.
 */
export class ChunkClaimUpdateEvent extends AbstractBroadcastEvent {

    static wireFields = {
        chunk: "int32",
        playerId: "int64",
    };

    /**
     * @param {number} chunk
     * @param {number} playerId
     */
    constructor(chunk, playerId) {
        super();
        this.chunk = chunk;
        this.playerId = playerId;
    }
}

/**
 * The outcome of the session's own claim/unclaim attempt (a ClaimResult). Targeted (publishTo).
 */
export class ClaimResultEvent extends AbstractEvent {

    static wireFields = {
        chunk: "int32",
        result: "int32",
    };

    /**
     * @param {number} chunk
     * @param {number} result
     */
    constructor(chunk, result) {
        super();
        this.chunk = chunk;
        this.result = result;
    }
}
