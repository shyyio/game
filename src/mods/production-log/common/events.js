import {AbstractEvent} from "@spup/sdk";

/**
 * Item types the receiving player produced for the first time this tick. Targeted
 * (publishToPlayer).
 */
export class ItemsDiscoveredEvent extends AbstractEvent {

    static wireFields = {
        itemTypeIds: "int32[]",
    };

    /**
     * @param {number[]} itemTypeIds
     */
    constructor(itemTypeIds) {
        super();
        this.itemTypeIds = itemTypeIds;
    }
}

/**
 * A player's all-time production counts and their place on each item's board, as parallel arrays.
 * Targeted (publishTo).
 */
export class ProductionLogEvent extends AbstractEvent {

    static wireFields = {
        playerId: "int64",
        itemTypeIds: "int32[]",
        counts: "int64[]",
        ranks: "int32[]",
    };

    /**
     * @param {number} playerId
     * @param {number[]} itemTypeIds
     * @param {number[]} counts
     * @param {number[]} ranks
     */
    constructor(playerId, itemTypeIds, counts, ranks) {
        super();
        this.playerId = playerId;
        this.itemTypeIds = itemTypeIds;
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
        itemTypeId: "int32",
        playerIds: "int64[]",
        scores: "int64[]",
        requesterRank: "int32",
        total: "int32",
    };

    /**
     * @param {number} itemTypeId
     * @param {number[]} playerIds
     * @param {number[]} scores
     * @param {number} requesterRank
     * @param {number} total
     */
    constructor(itemTypeId, playerIds, scores, requesterRank, total) {
        super();
        this.itemTypeId = itemTypeId;
        this.playerIds = playerIds;
        this.scores = scores;
        this.requesterRank = requesterRank;
        this.total = total;
    }
}
