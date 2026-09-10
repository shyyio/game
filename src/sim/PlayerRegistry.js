import {DEFAULT_MAX_CHUNKS} from "@/common/constants.js";
import {syntheticUsername} from "@/common/util.js";
import {generateFriendCode, normalizeFriendCode} from "@/common/FriendCode.js";

export const PLAYER_RECORD = "Player";
export const FRIEND_RECORD = "Friend";

export class PlayerRecord {

    /**
     * @param {number} playerRef
     * @param {string|null} sub - the auth server's pairwise identity for this player on this
     *     server, or null for a locally-registered record (ensure()) with no auth server involved
     * @param {string} username - a display name only; not unique
     * @param {number} maxChunks
     * @param {string} friendCode - random, unguessable; not derived from playerRef or sub
     */
    constructor(playerRef, sub, username, maxChunks, friendCode) {
        this.playerRef = playerRef;
        this.sub = sub;
        this.username = username;
        this.maxChunks = maxChunks;
        this.friendCode = friendCode;

        /**
         * @type {Set<number>} playerRefs allowed to build in this player's chunks
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

        /**
         * @type {Map<string, PlayerRecord>} keyed by normalizeFriendCode() output
         */
        this._byFriendCode = new Map();
        this._nextPlayerRef = 1;
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
        return this._register(new PlayerRecord(this._nextPlayerRef, sub, username, DEFAULT_MAX_CHUNKS, this._freshFriendCode()));
    }

    /**
     * Registers a record under an externally chosen id (local sessions, tests) if none exists.
     * @param {number} playerRef
     * @returns {PlayerRecord}
     */
    ensure(playerRef) {
        const existing = this._byId.get(playerRef);
        if (existing !== undefined) {
            return existing;
        }
        return this._register(new PlayerRecord(playerRef, null, syntheticUsername(playerRef), DEFAULT_MAX_CHUNKS, this._freshFriendCode()));
    }

    /**
     * @param {string} code - as typed by a player, any casing/spacing/dashing
     * @returns {PlayerRecord|undefined}
     */
    findPlayerByFriendCode(code) {
        const normalized = normalizeFriendCode(code);
        if (normalized === null) {
            return undefined;
        }
        return this._byFriendCode.get(normalized);
    }

    /**
     * A friend code not already assigned to another player on this server.
     * @private
     * @returns {string}
     */
    _freshFriendCode() {
        let code = generateFriendCode();
        while (this._byFriendCode.has(normalizeFriendCode(code))) {
            code = generateFriendCode();
        }
        return code;
    }

    /**
     * Indexes a record and keeps the id counter past every registered id.
     * @private
     * @param {PlayerRecord} record
     * @returns {PlayerRecord}
     */
    _register(record) {
        this._byId.set(record.playerRef, record);
        if (record.sub !== null) {
            this._bySub.set(record.sub, record);
        }
        this._byFriendCode.set(normalizeFriendCode(record.friendCode), record);
        if (record.playerRef >= this._nextPlayerRef) {
            this._nextPlayerRef = record.playerRef + 1;
        }
        return record;
    }

    /**
     * @param {number} playerRef
     * @returns {PlayerRecord}
     */
    getPlayerByRef(playerRef) {
        const record = this._byId.get(playerRef);
        if (record === undefined) {
            throw new RangeError(`Unknown playerRef: ${playerRef}`);
        }
        return record;
    }

    /**
     * @param {number} playerRef
     * @returns {boolean}
     */
    has(playerRef) {
        return this._byId.has(playerRef);
    }

    /**
     * @param {number} playerRef
     * @param {number} friendId
     * @returns {void}
     */
    addFriend(playerRef, friendId) {
        this.getPlayerByRef(friendId);
        this.getPlayerByRef(playerRef).friends.add(friendId);
    }

    /**
     * @param {number} playerRef
     * @param {number} friendId
     * @returns {void}
     */
    removeFriend(playerRef, friendId) {
        this.getPlayerByRef(playerRef).friends.delete(friendId);
    }

    /**
     * The players whose friend lists contain `playerRef` (who granted them build rights).
     * Derived by scanning the roster: friendships change at user rate on a small map.
     * @param {number} playerRef
     * @returns {number[]}
     */
    getGrantedRefsByPlayerRef(playerRef) {
        const granters = [];
        for (const record of this._byId.values()) {
            if (record.friends.has(playerRef)) {
                granters.push(record.playerRef);
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
     * @returns {{playerRefs: number[], usernames: string[]}}
     */
    getDirectory() {
        const playerRefs = [];
        const usernames = [];
        for (const record of this._byId.values()) {
            playerRefs.push(record.playerRef);
            usernames.push(record.username);
        }
        return {playerRefs, usernames};
    }

    /**
     * @returns {object[]} the Player and Friend record tables
     */
    serializeRecords() {
        const playerRows = [];
        const friendRows = [];
        for (const record of this._byId.values()) {
            playerRows.push({
                player_id: record.playerRef,
                sub: record.sub,
                username: record.username,
                max_chunks: record.maxChunks,
                friend_code: record.friendCode,
            });
            for (const friendId of record.friends) {
                friendRows.push({player_id: record.playerRef, friend_id: friendId});
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
                    {name: "friend_code", kind: "text"},
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
        this._byFriendCode.clear();
        this._nextPlayerRef = 1;
        if (playerTable === undefined) {
            return;
        }
        for (const row of playerTable.rows) {
            const sub = row.sub === undefined ? null : row.sub;
            // Older saves predate friend codes; mint one on load rather than rejecting the save.
            const friendCode = row.friend_code === undefined ? this._freshFriendCode() : row.friend_code;
            this._register(new PlayerRecord(row.player_id, sub, row.username, row.max_chunks, friendCode));
        }
        if (friendTable === undefined) {
            return;
        }
        for (const row of friendTable.rows) {
            this.getPlayerByRef(row.player_id).friends.add(row.friend_id);
        }
    }
}
