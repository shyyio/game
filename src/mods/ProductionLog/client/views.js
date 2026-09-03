import {LEADERBOARD_PAGE_SIZE} from "../common/constants.js";

/**
 * The panel showing one player's log.
 */
export class LogView {

    /**
     * @param {number} playerId
     */
    constructor(playerId) {
        this.playerId = playerId;
    }
}

/**
 * The panel showing one item type's leaderboard, one page at a time, opened on the page holding
 * the player whose log it came from.
 */
export class ItemBoardView {

    /**
     * @param {number} itemType
     * @param {number} focusRank the rank to open on and center, 0 for none
     */
    constructor(itemType, focusRank) {
        this.itemType = itemType;
        this.focusRank = focusRank;
        this.offset = Math.floor(Math.max(focusRank - 1, 0) / LEADERBOARD_PAGE_SIZE) * LEADERBOARD_PAGE_SIZE;
    }

    /**
     * The focused rank's row on the current page, or null when it is on another page.
     * @returns {number|null}
     */
    get focusRow() {
        const row = this.focusRank - 1 - this.offset;
        if (this.focusRank === 0 || row < 0 || row >= LEADERBOARD_PAGE_SIZE) {
            return null;
        }
        return row;
    }
}
