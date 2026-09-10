import {DEFAULT_MAX_CHUNKS} from "@/common/constants.js";
import {syntheticUsername} from "@/common/util.js";
import {generateFriendCode, normalizeFriendCode} from "@/common/FriendCode.js";

export const PLAYER_TABLE = "Player";
export const FRIEND_TABLE = "Friend";

export class PlayerEntry {

    /**
     * @param {number} playerRef
     * @param {string|null} sub - the auth server's pairwise identity for this player on this
     *     server, or null for a locally-added entry with no auth server involved
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
         * @type {Map<number, PlayerEntry>}
         */
        this._byId = new Map();

        /**
         * @type {Map<string, PlayerEntry>}
         */
        this._bySub = new Map();

        /**
         * @type {Map<string, PlayerEntry>} keyed by normalizeFriendCode() output
         */
        this._byFriendCode = new Map();
        this._nextPlayerRef = 1;
    }

    /**
     * The player identified by `sub`, registered on first sight.
     * @param {string} sub
     * @param {string} username
     * @returns {PlayerEntry}
     */
    getOrCreate(sub, username) {
        if (typeof sub !== "string" || sub.length === 0) {
            throw new RangeError(`Invalid sub: ${JSON.stringify(sub)}`);
        }
        const existing = this._bySub.get(sub);
        if (existing !== undefined) {
            return existing;
        }
        return this._register(new PlayerEntry(this._nextPlayerRef, sub, username, DEFAULT_MAX_CHUNKS, this._generateFreshFriendCode()));
    }

    /**
     * The entry under an externally chosen id (local sessions, tests), added on first sight.
     * @param {number} playerRef
     * @returns {PlayerEntry}
     */
    getOrAddByPlayerRef(playerRef) {
        const existing = this._byId.get(playerRef);
        if (existing !== undefined) {
            return existing;
        }
        return this._register(new PlayerEntry(playerRef, null, syntheticUsername(playerRef), DEFAULT_MAX_CHUNKS, this._generateFreshFriendCode()));
    }

    /**
     * @param {string} code - as typed by a player, any casing/spacing/dashing
     * @returns {PlayerEntry|null}
     */
    getPlayerByFriendCodeOrNull(code) {
        const normalized = normalizeFriendCode(code);
        if (normalized === null) {
            return null;
        }
        const found = this._byFriendCode.get(normalized);
        if (found === undefined) {
            return null;
        }
        return found;
    }

    /**
     * A friend code not already assigned to another player on this server.
     * @private
     * @returns {string}
     */
    _generateFreshFriendCode() {
        let code = generateFriendCode();
        while (this._byFriendCode.has(normalizeFriendCode(code))) {
            code = generateFriendCode();
        }
        return code;
    }

    /**
     * Indexes an entry and keeps the id counter past every registered id.
     * @private
     * @param {PlayerEntry} entry
     * @returns {PlayerEntry}
     */
    _register(entry) {
        this._byId.set(entry.playerRef, entry);
        if (entry.sub !== null) {
            this._bySub.set(entry.sub, entry);
        }
        this._byFriendCode.set(normalizeFriendCode(entry.friendCode), entry);
        if (entry.playerRef >= this._nextPlayerRef) {
            this._nextPlayerRef = entry.playerRef + 1;
        }
        return entry;
    }

    /**
     * @param {number} playerRef
     * @returns {PlayerEntry}
     */
    getPlayerByRef(playerRef) {
        const entry = this._byId.get(playerRef);
        if (entry === undefined) {
            throw new RangeError(`Unknown playerRef: ${playerRef}`);
        }
        return entry;
    }

    /**
     * @param {number} playerRef
     * @returns {boolean}
     */
    hasPlayer(playerRef) {
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
        for (const entry of this._byId.values()) {
            if (entry.friends.has(playerRef)) {
                granters.push(entry.playerRef);
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
        const entry = this._byId.get(ownerId);
        if (entry === undefined) {
            return false;
        }
        return entry.friends.has(otherId);
    }

    /**
     * @returns {object[]} the Player and Friend tables
     */
    serializeTables() {
        const playerRows = [];
        const friendRows = [];
        for (const entry of this._byId.values()) {
            playerRows.push({
                playerRef: entry.playerRef,
                sub: entry.sub,
                username: entry.username,
                maxChunks: entry.maxChunks,
                friendCode: entry.friendCode,
            });
            for (const friendId of entry.friends) {
                friendRows.push({playerRef: entry.playerRef, friendRef: friendId});
            }
        }
        return [
            {
                name: PLAYER_TABLE,
                fields: [
                    {name: "playerRef", kind: "integer"},
                    {name: "sub", kind: "text"},
                    {name: "username", kind: "text"},
                    {name: "maxChunks", kind: "integer"},
                    {name: "friendCode", kind: "text"},
                ],
                rows: playerRows,
            },
            {
                name: FRIEND_TABLE,
                fields: [
                    {name: "playerRef", kind: "integer"},
                    {name: "friendRef", kind: "integer"},
                ],
                rows: friendRows,
            },
        ];
    }

    /**
     * @param {object|undefined} playerTable - the Player table; undefined clears
     * @param {object|undefined} friendTable - the Friend table
     * @returns {void}
     */
    deserializeTables(playerTable, friendTable) {
        this._byId.clear();
        this._bySub.clear();
        this._byFriendCode.clear();
        this._nextPlayerRef = 1;
        if (playerTable === undefined) {
            return;
        }
        for (const row of playerTable.rows) {
            this._register(new PlayerEntry(row.playerRef, row.sub, row.username, row.maxChunks, row.friendCode));
        }
        if (friendTable === undefined) {
            return;
        }
        for (const row of friendTable.rows) {
            this.getPlayerByRef(row.playerRef).friends.add(row.friendRef);
        }
    }
}
