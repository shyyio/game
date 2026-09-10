import {AbstractMessage} from "@spup/sdk";
import {LEADERBOARD_PAGE_SIZE} from "./constants.js";

/**
 * Asks for a player's all-time production counts; answered with a ProductionLogEvent.
 */
export class ProductionLogRequestMessage extends AbstractMessage {

    static wireFields = {
        playerRef: "int64",
    };

    /**
     * @param {number} playerRef
     */
    constructor(playerRef) {
        super();
        this.playerRef = playerRef;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.playerRef);
    }
}

/**
 * Whether an offset starts a leaderboard page.
 * @param {number} offset
 * @returns {boolean}
 */
function isPageOffsetValid(offset) {
    return Number.isInteger(offset) && offset >= 0 && offset % LEADERBOARD_PAGE_SIZE === 0;
}

/**
 * Asks for one page of an item type's production leaderboard; answered with an
 * ItemLeaderboardEvent.
 */
export class ItemLeaderboardRequestMessage extends AbstractMessage {

    static wireFields = {
        itemTypeId: "int32",
        offset: "int32",
    };

    /**
     * @param {number} itemTypeId
     * @param {number} offset first rank of the page, zero-based, a multiple of the page size
     */
    constructor(itemTypeId, offset) {
        super();
        this.itemTypeId = itemTypeId;
        this.offset = offset;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.itemTypeId) && this.itemTypeId >= 0 && isPageOffsetValid(this.offset);
    }
}
