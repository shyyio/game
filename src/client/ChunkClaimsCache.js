import {WelcomeEvent, PlayerDirectoryEvent, FriendListEvent} from "@/common/PlayerEvents.js";
import {ChunkClaimSyncEvent, ChunkClaimUpdateEvent} from "@/common/ClaimEvents.js";
import {DEFAULT_MAX_CHUNKS, PLAYER_ID_NONE} from "@/common/constants.js";
import {syntheticUsername} from "@/common/util.js";

/**
 * The client's mirror of chunk ownership plus the player directory: fed by the connect-time syncs
 * and the broadcast deltas, read by the claim border layer and the map-mode menu.
 */
export class ChunkClaimsCache {

    constructor() {
        /**
         * @type {number|null} set by the welcome; null until then
         */
        this.ownPlayerId = null;
        this.maxChunks = DEFAULT_MAX_CHUNKS;

        /**
         * @type {Map<number, number>} chunk ordinal -> owning playerId
         */
        this._ownerByChunk = new Map();

        /**
         * @type {Map<number, string>} playerId -> username
         */
        this._usernameByPlayer = new Map();

        /**
         * @type {Set<number>} playerIds on the own friend list
         */
        this._friendIds = new Set();
        this._updateListeners = [];
    }

    /**
     * Registers a listener called with the chunk ordinals a claim change touched.
     * @param {function(number[]): void} listener
     * @returns {void}
     */
    onUpdate(listener) {
        this._updateListeners.push(listener);
    }

    /**
     * Applies a player/claim event; the class list lives here alone.
     * @param {AbstractEvent} event
     * @returns {boolean} whether the event was consumed
     */
    onEvent(event) {
        if (event instanceof WelcomeEvent) {
            this.ownPlayerId = event.playerId;
            this.maxChunks = event.maxChunks;
            return true;
        }
        if (event instanceof PlayerDirectoryEvent) {
            for (let i = 0; i < event.playerIds.length; i += 1) {
                this._usernameByPlayer.set(event.playerIds[i], event.usernames[i]);
            }
            return true;
        }
        if (event instanceof FriendListEvent) {
            this._friendIds = new Set(event.playerIds);
            return true;
        }
        if (event instanceof ChunkClaimSyncEvent) {
            const touched = new Set(this._ownerByChunk.keys());
            this._ownerByChunk.clear();
            for (let i = 0; i < event.chunks.length; i += 1) {
                this._ownerByChunk.set(event.chunks[i], event.playerIds[i]);
                touched.add(event.chunks[i]);
            }
            this._notify([...touched]);
            return true;
        }
        if (event instanceof ChunkClaimUpdateEvent) {
            if (event.playerId === PLAYER_ID_NONE) {
                this._ownerByChunk.delete(event.chunk);
            } else {
                this._ownerByChunk.set(event.chunk, event.playerId);
            }
            this._notify([event.chunk]);
            return true;
        }
        return false;
    }

    /**
     * @param {number} chunk
     * @returns {number} the owning playerId, or PLAYER_ID_NONE when unclaimed
     */
    ownerOf(chunk) {
        const owner = this._ownerByChunk.get(chunk);
        if (owner === undefined) {
            return PLAYER_ID_NONE;
        }
        return owner;
    }

    /**
     * @returns {number} chunks the own player holds
     */
    ownCount() {
        let count = 0;
        for (const owner of this._ownerByChunk.values()) {
            if (owner === this.ownPlayerId) {
                count += 1;
            }
        }
        return count;
    }

    /**
     * @returns {IterableIterator<[number, number]>} [chunk, playerId] pairs
     */
    entries() {
        return this._ownerByChunk.entries();
    }

    /**
     * @param {number} playerId
     * @returns {string}
     */
    usernameOf(playerId) {
        const username = this._usernameByPlayer.get(playerId);
        if (username === undefined) {
            return syntheticUsername(playerId);
        }
        return username;
    }

    /**
     * @param {number} playerId
     * @returns {boolean}
     */
    isFriend(playerId) {
        return this._friendIds.has(playerId);
    }

    /**
     * @private
     * @param {number[]} chunks
     * @returns {void}
     */
    _notify(chunks) {
        for (const listener of this._updateListeners) {
            listener(chunks);
        }
    }
}
