import {DEFAULT_MAX_CHUNKS} from "@/common/constants.js";
import {syntheticUsername} from "@/common/util.js";

export const PLAYER_RECORD = "Player";
export const FRIEND_RECORD = "Friend";

export class PlayerRecord {

    /**
     * @param {number} playerId
     * @param {string|null} sub - the auth server's pairwise identity for this player on this
     *     server, or null for a locally-registered record (ensure()) with no auth server involved
     * @param {string} username - a display name only; not unique
     * @param {number} maxChunks
     */
    constructor(playerId, sub, username, maxChunks) {
        this.playerId = playerId;
        this.sub = sub;
        this.username = username;
        this.maxChunks = maxChunks;

        /**
         * @type {Set<number>} playerIds allowed to build in this player's chunks
         */
        this.friends = new Set();
    }
}

/**
 * The persistent player roster: stable ids, auth-server identities, display names, chunk
 * allowances, friend lists. Identity resolution lives in getOrCreate, keyed by the auth server's
 * pairwise sub — display names are cosmetic only and may repeat across accounts.
 */
export class PlayerRegistry {

    constructor() {
        /**
         * @type {Map<number, PlayerRecord>}
         */
        this._byId = new Map();

        /**
         * @type {Map<string, PlayerRecord>}
         */
        this._bySub = new Map();
        this._nextPlayerId = 1;
    }

    /**
     * The player identified by `sub`, registered on first sight.
     * @param {string} sub
     * @param {string} username
     * @returns {PlayerRecord}
     */
    getOrCreate(sub, username) {
        if (typeof sub !== "string" || sub.length === 0) {
            throw new RangeError(`Invalid sub: ${JSON.stringify(sub)}`);
        }
        const existing = this._bySub.get(sub);
        if (existing !== undefined) {
            return existing;
        }
        return this._register(new PlayerRecord(this._nextPlayerId, sub, username, DEFAULT_MAX_CHUNKS));
    }

    /**
     * Registers a record under an externally chosen id (local sessions, tests) if none exists.
     * @param {number} playerId
     * @returns {PlayerRecord}
     */
    ensure(playerId) {
        const existing = this._byId.get(playerId);
        if (existing !== undefined) {
            return existing;
        }
        return this._register(new PlayerRecord(playerId, null, syntheticUsername(playerId), DEFAULT_MAX_CHUNKS));
    }

    /**
     * Indexes a record and keeps the id counter past every registered id.
     * @private
     * @param {PlayerRecord} record
     * @returns {PlayerRecord}
     */
    _register(record) {
        this._byId.set(record.playerId, record);
        if (record.sub !== null) {
            this._bySub.set(record.sub, record);
        }
        if (record.playerId >= this._nextPlayerId) {
            this._nextPlayerId = record.playerId + 1;
        }
        return record;
    }

    /**
     * @param {number} playerId
     * @returns {PlayerRecord}
     */
    byId(playerId) {
        const record = this._byId.get(playerId);
        if (record === undefined) {
            throw new RangeError(`Unknown playerId: ${playerId}`);
        }
        return record;
    }

    /**
     * @param {number} playerId
     * @returns {boolean}
     */
    has(playerId) {
        return this._byId.has(playerId);
    }

    /**
     * @param {number} playerId
     * @param {number} friendId
     * @returns {void}
     */
    addFriend(playerId, friendId) {
        this.byId(friendId);
        this.byId(playerId).friends.add(friendId);
    }

    /**
     * @param {number} playerId
     * @param {number} friendId
     * @returns {void}
     */
    removeFriend(playerId, friendId) {
        this.byId(playerId).friends.delete(friendId);
    }

    /**
     * The players whose friend lists contain `playerId` (who granted them build rights).
     * Derived by scanning the roster: friendships change at user rate on a small map.
     * @param {number} playerId
     * @returns {number[]}
     */
    grantedBy(playerId) {
        const granters = [];
        for (const record of this._byId.values()) {
            if (record.friends.has(playerId)) {
                granters.push(record.playerId);
            }
        }
        return granters;
    }

    /**
     * Whether `otherId` is on `ownerId`'s friend list.
     * @param {number} ownerId
     * @param {number} otherId
     * @returns {boolean}
     */
    isFriend(ownerId, otherId) {
        const record = this._byId.get(ownerId);
        if (record === undefined) {
            return false;
        }
        return record.friends.has(otherId);
    }

    /**
     * Every known player as parallel arrays, for the directory sync event.
     * @returns {{playerIds: number[], usernames: string[]}}
     */
    directory() {
        const playerIds = [];
        const usernames = [];
        for (const record of this._byId.values()) {
            playerIds.push(record.playerId);
            usernames.push(record.username);
        }
        return {playerIds, usernames};
    }

    /**
     * @returns {object[]} the Player and Friend record tables
     */
    serializeRecords() {
        const playerRows = [];
        const friendRows = [];
        for (const record of this._byId.values()) {
            playerRows.push({
                player_id: record.playerId,
                sub: record.sub,
                username: record.username,
                max_chunks: record.maxChunks,
            });
            for (const friendId of record.friends) {
                friendRows.push({player_id: record.playerId, friend_id: friendId});
            }
        }
        return [
            {
                name: PLAYER_RECORD,
                fields: [
                    {name: "player_id", kind: "integer"},
                    {name: "sub", kind: "text"},
                    {name: "username", kind: "text"},
                    {name: "max_chunks", kind: "integer"},
                ],
                rows: playerRows,
            },
            {
                name: FRIEND_RECORD,
                fields: [
                    {name: "player_id", kind: "integer"},
                    {name: "friend_id", kind: "integer"},
                ],
                rows: friendRows,
            },
        ];
    }

    /**
     * @param {object|undefined} playerTable - the Player record table; undefined clears
     * @param {object|undefined} friendTable - the Friend record table
     * @returns {void}
     */
    deserializeRecords(playerTable, friendTable) {
        this._byId.clear();
        this._bySub.clear();
        this._nextPlayerId = 1;
        if (playerTable === undefined) {
            return;
        }
        for (const row of playerTable.rows) {
            const sub = row.sub === undefined ? null : row.sub;
            this._register(new PlayerRecord(row.player_id, sub, row.username, row.max_chunks));
        }
        if (friendTable === undefined) {
            return;
        }
        for (const row of friendTable.rows) {
            this.byId(row.player_id).friends.add(row.friend_id);
        }
    }
}
