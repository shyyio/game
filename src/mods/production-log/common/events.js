import {AbstractEvent} from "@spup/sdk";

/**
 * Item types the receiving player produced for the first time this tick. Targeted
 * (publishToPlayer).
 */
export class ItemsDiscoveredEvent extends AbstractEvent {

    static wireFields = {
        itemTypes: "int32[]",
    };

    /**
     * @param {number[]} itemTypes
     */
    constructor(itemTypes) {
        super();
        this.itemTypes = itemTypes;
    }
}

/**
 * A player's all-time production counts and their place on each item's board, as parallel arrays.
 * Targeted (publishTo).
 */
export class ProductionLogEvent extends AbstractEvent {

    static wireFields = {
        playerId: "int64",
        itemTypes: "int32[]",
        counts: "int64[]",
        ranks: "int32[]",
    };

    /**
     * @param {number} playerId
     * @param {number[]} itemTypes
     * @param {number[]} counts
     * @param {number[]} ranks
     */
    constructor(playerId, itemTypes, counts, ranks) {
        super();
        this.playerId = playerId;
        this.itemTypes = itemTypes;
        this.counts = counts;
        this.ranks = ranks;
    }
}

/**
 * One page of an item type's production leaderboard as parallel arrays, plus the requester's
 * own rank (0 when unranked) and the board's total ranked players. Targeted (publishTo).
 */
export class ItemLeaderboardEvent extends AbstractEvent {

    static wireFields = {
        itemType: "int32",
        playerIds: "int64[]",
        scores: "int64[]",
        requesterRank: "int32",
        total: "int32",
    };

    /**
     * @param {number} itemType
     * @param {number[]} playerIds
     * @param {number[]} scores
     * @param {number} requesterRank
     * @param {number} total
     */
    constructor(itemType, playerIds, scores, requesterRank, total) {
        super();
        this.itemType = itemType;
        this.playerIds = playerIds;
        this.scores = scores;
        this.requesterRank = requesterRank;
        this.total = total;
    }
}
