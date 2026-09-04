import {getOrCreate} from "@spup/sdk";
import {ITEM_PRODUCED_RECORD, LEADERBOARD_PAGE_SIZE} from "../common/constants.js";
import {ItemLeaderboardEvent} from "../common/events.js";

/**
 * Every player's all-time count of each item type produced. Pure state: the sim mod owns
 * attribution, discovery batching, and fan-out.
 */
export class ProductionLog {

    constructor() {
        /**
         * playerId -> (itemType -> count)
         * @type {Map<number, Map<number, number>>}
         */
        this._byPlayer = new Map();
    }

    /**
     * @param {number} playerId
     * @param {number} itemType
     * @param {number} amount
     * @returns {boolean} whether this is the player's first of the item type
     */
    add(playerId, itemType, amount) {
        const counts = getOrCreate(this._byPlayer, playerId, () => new Map());
        const previous = counts.get(itemType);
        if (previous === undefined) {
            counts.set(itemType, amount);
            return true;
        }
        counts.set(itemType, previous + amount);
        return false;
    }

    /**
     * @param {number} playerId
     * @returns {Map<number, number>} itemType -> count
     */
    countsOf(playerId) {
        const counts = this._byPlayer.get(playerId);
        if (counts === undefined) {
            return new Map();
        }
        return counts;
    }

    /**
     * One page of an item type's leaderboard: producers by count, most first, ties by player id.
     * @param {number} itemType
     * @param {number} offset first rank of the page, zero-based
     * @param {number} requesterId the asking player
     * @returns {ItemLeaderboardEvent}
     */
    itemPage(itemType, offset, requesterId) {
        const ranking = Array.from(this._byPlayer)
            .filter(([playerId, counts]) => counts.has(itemType))
            .map(([playerId, counts]) => [playerId, counts.get(itemType)])
            .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        const page = ranking.slice(offset, offset + LEADERBOARD_PAGE_SIZE);
        return new ItemLeaderboardEvent(
            itemType,
            page.map(entry => entry[0]),
            page.map(entry => entry[1]),
            this.rankOf(requesterId, itemType),
            ranking.length,
        );
    }

    /**
     * A player's 1-based place on an item's board, 0 when they never produced it: one more than
     * the producers ahead of them (more produced, or as much with a lower id).
     * @param {number} playerId
     * @param {number} itemType
     * @returns {number}
     */
    rankOf(playerId, itemType) {
        const own = this.countsOf(playerId).get(itemType);
        if (own === undefined) {
            return 0;
        }
        let ahead = 0;
        for (const [otherId, counts] of this._byPlayer) {
            const count = counts.get(itemType);
            if (count === undefined) {
                continue;
            }
            if (count > own || (count === own && otherId < playerId)) {
                ahead += 1;
            }
        }
        return 1 + ahead;
    }

    /**
     * @returns {object[]} the ItemProduced record table
     */
    serializeRecords() {
        const rows = [];
        for (const [playerId, counts] of this._byPlayer) {
            for (const [itemType, count] of counts) {
                rows.push({player_id: playerId, item_type: itemType, count: count});
            }
        }
        return [
            {
                name: ITEM_PRODUCED_RECORD,
                fields: [
                    {name: "player_id", kind: "integer"},
                    {name: "item_type", kind: "item"},
                    {name: "count", kind: "integer"},
                ],
                rows: rows,
            },
        ];
    }

    /**
     * @param {object|undefined} table - the ItemProduced record table; undefined clears
     * @param {ItemRegistry} items - a count for an item type it no longer holds is dropped, so a
     *     loadout change leaves no unnameable row in the log
     * @returns {void}
     */
    deserializeRecords(table, items) {
        this._byPlayer.clear();
        if (table === undefined) {
            return;
        }
        for (const row of table.rows) {
            if (items.get(row.item_type) === undefined) {
                continue;
            }
            this.add(row.player_id, row.item_type, row.count);
        }
    }
}
