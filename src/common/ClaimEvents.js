import {AbstractEvent} from "@/common/AbstractEvent.js";

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
    CLAIM_RESULT_NOT_EMPTY: 7,
};

/**
 * The session's own claimed chunks, sent to it on connect. Targeted (publishTo).
 */
export class OwnClaimsSyncEvent extends AbstractEvent {

    static wireFields = {
        chunks: "int32[]",
    };

    /**
     * @param {number[]} chunks
     */
    constructor(chunks) {
        super();
        this.chunks = chunks;
    }
}

/**
 * One chunk's ownership changed; playerId PLAYER_ID_NONE means it is now unclaimed. Routed to the
 * chunk's topic; the sim also targets it at the affected owner's sessions and at a session whose
 * viewport gains a claimed chunk.
 */
export class ChunkClaimUpdateEvent extends AbstractEvent {

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

    /**
     * @param {EventBus} bus
     * @returns {Set<number>|undefined}
     */
    subscribersIn(bus) {
        return bus.chunkSubscribers(this.chunk);
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
