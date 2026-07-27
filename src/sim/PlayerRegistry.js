import {DEFAULT_MAX_CHUNKS, USERNAME_PATTERN} from "@/common/constants.js";
import {syntheticUsername} from "@/common/util.js";

export const PLAYER_RECORD = "Player";
export const FRIEND_RECORD = "Friend";

export class PlayerRecord {

    /**
     * @param {number} playerId
     * @param {string} username
     * @param {number} maxChunks
     */
    constructor(playerId, username, maxChunks) {
        this.playerId = playerId;
        this.username = username;
        this.maxChunks = maxChunks;

        /**
         * @type {Set<number>} playerIds allowed to build in this player's chunks
         */
        this.friends = new Set();
    }
}

/**
 * The persistent player roster: stable ids, usernames, chunk allowances, friend lists. Identity
 * resolution lives in getOrCreate — the seam a Steam-SSO lookup replaces later.
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
        this._byUsername = new Map();
        this._nextPlayerId = 1;
    }

    /**
     * The player named `username`, registered on first sight.
     * @param {string} username
     * @returns {PlayerRecord}
     */
    getOrCreate(username) {
        if (!USERNAME_PATTERN.test(username)) {
            throw new RangeError(`Invalid username: ${JSON.stringify(username)}`);
        }
        const existing = this._byUsername.get(username);
        if (existing !== undefined) {
            return existing;
        }
        return this._register(new PlayerRecord(this._nextPlayerId, username, DEFAULT_MAX_CHUNKS));
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
        return this._register(new PlayerRecord(playerId, syntheticUsername(playerId), DEFAULT_MAX_CHUNKS));
    }

    /**
     * Indexes a record and keeps the id counter past every registered id.
     * @private
     * @param {PlayerRecord} record
     * @returns {PlayerRecord}
     */
    _register(record) {
        this._byId.set(record.playerId, record);
        this._byUsername.set(record.username, record);
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
     * @param {string} username
     * @returns {PlayerRecord|null}
     */
    findByUsername(username) {
        const record = this._byUsername.get(username);
        if (record === undefined) {
            return null;
        }
        return record;
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
        this._byUsername.clear();
        this._nextPlayerId = 1;
        if (playerTable === undefined) {
            return;
        }
        for (const row of playerTable.rows) {
            this._register(new PlayerRecord(row.player_id, row.username, row.max_chunks));
        }
        if (friendTable === undefined) {
            return;
        }
        for (const row of friendTable.rows) {
            this.byId(row.player_id).friends.add(row.friend_id);
        }
    }
}
