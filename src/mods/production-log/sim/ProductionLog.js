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
         * playerRef -> (itemTypeId -> count)
         * @type {Map<number, Map<number, number>>}
         */
        this._byPlayer = new Map();
    }

    /**
     * @param {number} playerRef
     * @param {number} itemTypeId
     * @param {number} amount
     * @returns {boolean} whether this is the player's first of the item type
     */
    add(playerRef, itemTypeId, amount) {
        const counts = getOrCreate(this._byPlayer, playerRef, () => new Map());
        const previous = counts.get(itemTypeId);
        if (previous === undefined) {
            counts.set(itemTypeId, amount);
            return true;
        }
        counts.set(itemTypeId, previous + amount);
        return false;
    }

    /**
     * @param {number} playerRef
     * @returns {Map<number, number>} itemTypeId -> count
     */
    getCountsByPlayerRef(playerRef) {
        const counts = this._byPlayer.get(playerRef);
        if (counts === undefined) {
            return new Map();
        }
        return counts;
    }

    /**
     * One page of an item type's leaderboard: producers by count, most first, ties by player ref.
     * @param {number} itemTypeId
     * @param {number} offset first rank of the page, zero-based
     * @param {number} requesterId the asking player
     * @returns {ItemLeaderboardEvent}
     */
    getItemPageByItemTypeId(itemTypeId, offset, requesterId) {
        const ranking = Array.from(this._byPlayer)
            .filter(([playerRef, counts]) => counts.has(itemTypeId))
            .map(([playerRef, counts]) => [playerRef, counts.get(itemTypeId)])
            .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        const page = ranking.slice(offset, offset + LEADERBOARD_PAGE_SIZE);
        return new ItemLeaderboardEvent(
            itemTypeId,
            page.map(entry => entry[0]),
            page.map(entry => entry[1]),
            this.getRankByPlayerRef(requesterId, itemTypeId),
            ranking.length,
        );
    }

    /**
     * A player's 1-based place on an item's board, 0 when they never produced it: one more than
     * the producers ahead of them (more produced, or as much with a lower id).
     * @param {number} playerRef
     * @param {number} itemTypeId
     * @returns {number}
     */
    getRankByPlayerRef(playerRef, itemTypeId) {
        const own = this.getCountsByPlayerRef(playerRef).get(itemTypeId);
        if (own === undefined) {
            return 0;
        }
        let ahead = 0;
        for (const [otherId, counts] of this._byPlayer) {
            const count = counts.get(itemTypeId);
            if (count === undefined) {
                continue;
            }
            if (count > own || (count === own && otherId < playerRef)) {
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
        for (const [playerRef, counts] of this._byPlayer) {
            for (const [itemTypeId, count] of counts) {
                rows.push({player_id: playerRef, item_type: itemTypeId, count: count});
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
            if (items.findItemTypeByTypeId(row.item_type) === undefined) {
                continue;
            }
            this.add(row.player_id, row.item_type, row.count);
        }
    }
}
