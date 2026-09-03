import {AbstractMessage} from "@spup/sdk";
import {LEADERBOARD_PAGE_SIZE} from "./constants.js";

/**
 * Asks for a player's all-time production counts; answered with a ProductionLogEvent.
 */
export class ProductionLogRequestMessage extends AbstractMessage {

    static wireFields = {
        playerId: "int64",
    };

    /**
     * @param {number} playerId
     */
    constructor(playerId) {
        super();
        this.playerId = playerId;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.playerId);
    }
}

/**
 * Whether an offset starts a leaderboard page.
 * @param {number} offset
 * @returns {boolean}
 */
function pageOffsetValid(offset) {
    return Number.isInteger(offset) && offset >= 0 && offset % LEADERBOARD_PAGE_SIZE === 0;
}

/**
 * Asks for one page of an item type's production leaderboard; answered with an
 * ItemLeaderboardEvent.
 */
export class ItemLeaderboardRequestMessage extends AbstractMessage {

    static wireFields = {
        itemType: "int32",
        offset: "int32",
    };

    /**
     * @param {number} itemType
     * @param {number} offset first rank of the page, zero-based, a multiple of the page size
     */
    constructor(itemType, offset) {
        super();
        this.itemType = itemType;
        this.offset = offset;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.itemType) && this.itemType >= 0 && pageOffsetValid(this.offset);
    }
}
